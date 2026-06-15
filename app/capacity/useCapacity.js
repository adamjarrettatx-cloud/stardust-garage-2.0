'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { deriveStatus } from '@/lib/capacity-utils';

// Shared client hook powering the front-door and exit-door pages.
//
// Two modes:
//   * TEAM mode (no token): the page is opened by a logged-in team member. Uses
//     the cookie-authenticated /api/capacity/status + /operation endpoints and
//     subscribes to Supabase realtime postgres_changes for instant updates.
//   * DEVICE mode (token set): the page is a provisioned Jelly2 holding a device
//     token. Uses the token-scoped /api/capacity/device/* endpoints (token sent
//     as a Bearer header) and relies on polling only — a device is not a
//     Supabase user, so it cannot open an RLS-gated realtime channel.
//
// In device mode an `unauthorized` flag is raised when the token is missing,
// invalid, or revoked so the door page can show a clear "Device not authorized"
// screen instead of an empty counter.
//
// Returns { session, status, connected, loading, error, unauthorized, refresh, runOp }.
export function useCapacity({ pollMs = 4000, token = null } = {}) {
  const isDevice = Boolean(token);

  const [session, setSession] = useState(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const supabaseRef = useRef(null);

  // Token is held in a ref so it never lands in component state / React DevTools
  // props beyond what the URL already exposes, and so callbacks stay stable.
  const tokenRef = useRef(token);
  tokenRef.current = token;

  if (supabaseRef.current === null && !isDevice) {
    supabaseRef.current = createClient();
  }

  const statusUrl = isDevice ? '/api/capacity/device/status' : '/api/capacity/status';
  const operationUrl = isDevice ? '/api/capacity/device/operation' : '/api/capacity/operation';

  // Build request headers, attaching the device token as a Bearer header in
  // device mode so it stays out of the path and server logs where possible.
  const authHeaders = useCallback((extra = {}) => {
    const h = { ...extra };
    if (isDevice && tokenRef.current) h.Authorization = `Bearer ${tokenRef.current}`;
    return h;
  }, [isDevice]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(statusUrl, { cache: 'no-store', headers: authHeaders() });
      if (!res.ok) {
        if (res.status === 401) {
          if (isDevice) {
            setUnauthorized(true);
          } else {
            setError('Not authorized. Please sign in as a team member.');
          }
        }
        return;
      }
      const json = await res.json();
      setUnauthorized(false);
      setSession(json.session || null);
      setError(null);
    } catch {
      // Network blip — leave the last known good state, polling will retry.
    } finally {
      setLoading(false);
    }
  }, [statusUrl, authHeaders, isDevice]);

  // Initial load + realtime subscription (team mode only).
  useEffect(() => {
    let cancelled = false;
    refresh();

    if (isDevice) {
      // Device mode: no realtime channel (not a Supabase user). Polling below
      // keeps the count fresh.
      return () => { cancelled = true; };
    }

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
  }, [refresh, isDevice]);

  // Polling fallback / safety net. Runs always; cheap and guarantees freshness
  // even if the realtime socket silently drops (and is the only sync in device
  // mode).
  useEffect(() => {
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  // Fire a mutation, then optimistically apply the returned authoritative
  // session so the tapping device updates instantly.
  const runOp = useCallback(async (op, extra = {}) => {
    setError(null);
    try {
      const res = await fetch(operationUrl, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op, ...extra }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // In device mode, a 401 (token missing/invalid) or 403 (token revoked
        // or scope-rejected by the device RPC) means this device is no longer
        // authorized — show the clean lockout screen instead of a transient
        // error so a revoked Jelly2 stops dead rather than flashing "Action
        // failed." on every tap.
        if (isDevice && (res.status === 401 || res.status === 403)) {
          setUnauthorized(true);
        }
        setError(json.error || 'Action failed.');
        return { ok: false, code: json.code, error: json.error };
      }
      if (json.session) setSession(json.session);
      return { ok: true, session: json.session, status: json.status };
    } catch {
      setError('Network error. Try again.');
      return { ok: false, code: 'network' };
    }
  }, [operationUrl, authHeaders, isDevice]);

  return {
    session,
    status: deriveStatus(session),
    connected,
    loading,
    error,
    unauthorized,
    refresh,
    runOp,
  };
}
