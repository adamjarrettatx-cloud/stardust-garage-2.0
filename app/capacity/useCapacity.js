'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { deriveStatus } from '@/lib/capacity-utils';

// Shared client hook powering the front-door and exit-door pages.
//
// Keeps a live view of the active session by:
//   1. Subscribing to Supabase realtime postgres_changes on capacity_sessions
//      (preferred — both Jelly2 devices update the instant either taps).
//   2. Falling back to short polling (every `pollMs`) when realtime is not
//      available (stub client) or the channel isn't SUBSCRIBED. Polling also
//      acts as a safety net so a dropped socket can't leave a stale count.
//
// Returns { session, status, connected, loading, error, refresh, runOp }.
export function useCapacity({ pollMs = 4000 } = {}) {
  const [session, setSession] = useState(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const supabaseRef = useRef(null);

  if (supabaseRef.current === null) {
    supabaseRef.current = createClient();
  }

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/capacity/status', { cache: 'no-store' });
      if (!res.ok) {
        if (res.status === 401) setError('Not authorized. Please sign in as a team member.');
        return;
      }
      const json = await res.json();
      setSession(json.session || null);
      setError(null);
    } catch {
      // Network blip — leave the last known good state, polling will retry.
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + realtime subscription.
  useEffect(() => {
    let cancelled = false;
    refresh();

    const supabase = supabaseRef.current;
    // Stub client (no realtime) — skip channel, rely on polling below.
    if (!supabase || typeof supabase.channel !== 'function') {
      return () => { cancelled = true; };
    }

    const channel = supabase
      .channel('capacity-counter')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'capacity_sessions' },
        () => { if (!cancelled) refresh(); },
      )
      .subscribe((statusStr) => {
        if (!cancelled) setConnected(statusStr === 'SUBSCRIBED');
      });

    return () => {
      cancelled = true;
      try { supabase.removeChannel(channel); } catch { /* ignore */ }
    };
  }, [refresh]);

  // Polling fallback / safety net. Runs always; cheap and guarantees freshness
  // even if the realtime socket silently drops.
  useEffect(() => {
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  // Fire a mutation against the API, then optimistically apply the returned
  // authoritative session so the tapping device updates instantly (the other
  // devices catch up via realtime/poll).
  const runOp = useCallback(async (op, extra = {}) => {
    setError(null);
    try {
      const res = await fetch('/api/capacity/operation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op, ...extra }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Action failed.');
        return { ok: false, code: json.code, error: json.error };
      }
      if (json.session) setSession(json.session);
      return { ok: true, session: json.session, status: json.status };
    } catch {
      setError('Network error. Try again.');
      return { ok: false, code: 'network' };
    }
  }, []);

  return {
    session,
    status: deriveStatus(session),
    connected,
    loading,
    error,
    refresh,
    runOp,
  };
}
