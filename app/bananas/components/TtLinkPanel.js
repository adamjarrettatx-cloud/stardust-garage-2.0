'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { adminFetch } from '@/lib/admin-fetch';
import RefreshMetricsButton from '../analytics/RefreshMetricsButton';

function fmtFetched(iso) {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

const METRICS_STATUS_LABEL = {
  ok: 'up to date',
  pending: 'not yet fetched',
  not_configured: 'not configured',
  error: 'last refresh errored',
};

// Admin panel for linking/unlinking a local event to a TicketTailor event
// series. Unlike the rest of EventForm (which writes via the client Supabase
// session + RLS), this routes the change through the server endpoint
// /api/admin/events/:id/tt-link, which re-derives admin status with
// requireAdminMfa(), validates the id server-side, and can verify the series
// against TicketTailor read-only. The API key is never seen by the browser.
//
// Rendered only for an existing event (needs an id). `initialSeriesId` seeds
// the current link state.
export default function TtLinkPanel({ eventId, initialSeriesId, metrics = null }) {
  const router = useRouter();
  const [seriesId, setSeriesId] = useState(initialSeriesId || '');
  const [savedSeriesId, setSavedSeriesId] = useState(initialSeriesId || '');
  const [ttSeries, setTtSeries] = useState([]);
  const [ttSeriesError, setTtSeriesError] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [showRefreshHint, setShowRefreshHint] = useState(false);

  const labelClass = 'block text-[12px] font-semibold tracking-[0.14em] mb-2';
  const labelStyle = { color: '#8a8a8a' };
  const inputClass =
    'w-full px-5 py-3.5 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30';
  const inputStyle = { background: '#141414', borderColor: 'rgba(255,255,255,0.1)', color: '#f5f5f5' };

  // Load the TT series list so admins can pick by name. Read-only admin route;
  // degrades to manual entry if the key is missing or the call fails.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/tt-event-series');
        const body = await res.json();
        if (cancelled) return;
        if (res.ok && Array.isArray(body.series)) {
          setTtSeries(body.series);
        } else {
          setTtSeriesError(body?.error || 'Could not load TicketTailor event series');
        }
      } catch (err) {
        if (!cancelled) setTtSeriesError(err?.message || 'Could not load TicketTailor event series');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isLinked = Boolean(savedSeriesId);
  const isDirty = (seriesId || '') !== (savedSeriesId || '');

  async function submit({ verify, clear }) {
    setSaving(true);
    setMsg('');
    setShowRefreshHint(false);
    const value = clear ? null : seriesId.trim() || null;
    try {
      const res = await adminFetch(`/api/admin/events/${eventId}/tt-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tt_event_series_id: value, verify: verify && !clear }),
      });
      setSavedSeriesId(res.tt_event_series_id || '');
      setSeriesId(res.tt_event_series_id || '');
      if (res.verifyNote) {
        setMsg(res.verifyNote);
      } else if (res.linked) {
        setMsg('Linked to TicketTailor.');
      } else {
        setMsg('Unlinked from TicketTailor.');
      }
      setShowRefreshHint(true);
      router.refresh();
    } catch (err) {
      setMsg(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rounded-[12px] border p-5"
      style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.08)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <label className={labelClass} style={labelStyle}>
          TICKETTAILOR LINK
        </label>
        <span
          className="text-[11px] font-semibold tracking-[0.12em] px-2.5 py-1 rounded-full"
          style={{
            color: isLinked ? '#0f1a12' : '#8a8a8a',
            background: isLinked ? '#4ade80' : 'rgba(255,255,255,0.08)',
          }}
        >
          {isLinked ? 'LINKED' : 'NOT LINKED'}
        </span>
      </div>

      {ttSeries.length > 0 ? (
        <select
          value={seriesId}
          onChange={(e) => setSeriesId(e.target.value)}
          className={inputClass}
          style={inputStyle}
        >
          <option value="" style={{ background: '#141414' }}>
            — None —
          </option>
          {ttSeries.map((s) => (
            <option key={s.id} value={s.id} style={{ background: '#141414' }}>
              {s.name} ({s.id})
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={seriesId}
          onChange={(e) => setSeriesId(e.target.value)}
          placeholder="es_xxxxxxxx"
          className={inputClass}
          style={inputStyle}
        />
      )}

      <p className="text-[11px] mt-2" style={{ color: '#555' }}>
        {ttSeriesError
          ? `Could not load series list (${ttSeriesError}). Enter the series ID manually.`
          : 'Saved server-side and validated as a TicketTailor series ID (usually "es_…"). Used by analytics and member discount codes.'}
      </p>

      <div className="flex flex-wrap gap-3 mt-4">
        <button
          type="button"
          onClick={() => submit({ verify: true })}
          disabled={saving || !isDirty || !seriesId.trim()}
          className="px-6 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5 disabled:opacity-40"
          style={{ background: '#ffffff', color: '#0a0a0a' }}
        >
          {saving ? 'SAVING…' : 'SAVE & VERIFY LINK'}
        </button>
        {isLinked && (
          <button
            type="button"
            onClick={() => submit({ clear: true })}
            disabled={saving}
            className="px-6 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] border transition-colors hover:bg-white/5 disabled:opacity-40"
            style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
          >
            UNLINK
          </button>
        )}
      </div>

      {msg && (
        <p className="text-[13px] mt-3" style={{ color: '#c8c8c8' }}>
          {msg}
        </p>
      )}

      {showRefreshHint && (
        <p className="text-[12px] mt-2" style={{ color: '#ffb84d' }}>
          Link changed — refresh metrics below (or from{' '}
          <Link href="/bananas/analytics" className="underline">
            Event Analytics
          </Link>
          ) to populate sales figures.
        </p>
      )}

      {/* Per-event metrics refresh. Read-only against TicketTailor — it only
          re-pulls THIS event's cached sales numbers. Shown once linked. */}
      {isLinked && (
        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[12px]" style={{ color: '#8a8a8a' }}>
              Metrics:{' '}
              <span style={{ color: metrics?.status === 'ok' ? '#86efac' : '#c8c8c8' }}>
                {METRICS_STATUS_LABEL[metrics?.status] || 'not yet fetched'}
              </span>
              {' · last fetched '}
              <span style={{ color: '#c8c8c8' }}>{fmtFetched(metrics?.fetched_at)}</span>
            </div>
            <RefreshMetricsButton eventId={eventId} label="Refresh metrics" compact />
          </div>
          <p className="text-[11px] mt-2" style={{ color: '#555' }}>
            Pulls this event&apos;s ticket sales from TicketTailor (read-only) into the analytics cache.
          </p>
        </div>
      )}
    </div>
  );
}
