'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { adminFetch } from '@/lib/admin-fetch';
import { formatSlotRange } from '@/lib/booking-helpers';
import { formatMoney, cumulativePayByContact, payRequestStatusLabel } from '@/lib/pay-request-helpers';
import UnderlineTabs from '../components/UnderlineTabs';

const cardStyle = { background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' };
const altCardStyle = { background: 'var(--auth-card-bg-alt)', borderColor: 'var(--auth-card-border)' };


// One pending request: contact, event, slot, amount, and the two review
// actions. Reject opens an inline reason field rather than a browser
// prompt() so the required-reason validation can show inline like every
// other form in the admin panel.
function RequestRow({ req, onApprove, onReject, busy }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const submitReject = () => {
    if (!reason.trim()) {
      setError('A rejection reason is required.');
      return;
    }
    onReject(req.id, reason.trim());
  };

  return (
    <div className="rounded-[10px] border p-4" style={altCardStyle}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/bananas/contacts/${req.contact_id}`} className="text-[15px] font-bold hover:underline" style={{ color: 'var(--auth-text-strong)' }}>
              {req.contact?.display_name || 'Unknown contact'}
            </Link>
            <span className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
              &middot; {req.event?.title || 'Unknown event'}
            </span>
          </div>
          <div className="text-[13px] mt-1" style={{ color: 'var(--auth-text)' }}>
            {formatSlotRange(req.booking?.slot_start, req.booking?.slot_end)}
          </div>
          <div className="text-[16px] font-bold mt-1" style={{ color: 'var(--auth-text-strong)' }}>
            {formatMoney(req.amount_cents)}
          </div>
        </div>
        {!rejecting && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onApprove(req.id)}
              disabled={busy}
              className="px-5 py-2.5 rounded-full text-[11px] font-semibold tracking-[0.12em] transition-all hover:-translate-y-0.5 disabled:opacity-40"
              style={{ background: 'var(--auth-success)', color: 'var(--auth-accent-text)' }}
            >
              APPROVE
            </button>
            <button
              type="button"
              onClick={() => setRejecting(true)}
              disabled={busy}
              className="px-5 py-2.5 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors disabled:opacity-40"
              style={{ borderColor: 'var(--auth-danger-border)', color: 'var(--auth-danger)' }}
            >
              REJECT
            </button>
          </div>
        )}
      </div>

      {rejecting && (
        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--auth-row-border)' }}>
          <label className="block text-[11px] font-semibold tracking-[0.14em] mb-2" style={{ color: 'var(--auth-muted)' }}>
            REJECTION REASON (shown to the artist)
          </label>
          <textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError('');
            }}
            rows={2}
            className="w-full px-4 py-3 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30 mb-3"
            style={{ background: 'var(--auth-input-bg)', borderColor: 'var(--auth-input-border)', color: 'var(--auth-input-text)' }}
          />
          {error && (
            <p className="text-[12px] mb-3" style={{ color: 'var(--auth-danger)' }}>
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={submitReject}
              disabled={busy}
              className="px-5 py-2.5 rounded-full text-[11px] font-semibold tracking-[0.12em] disabled:opacity-40"
              style={{ background: 'var(--auth-danger)', color: 'var(--auth-accent-text)' }}
            >
              {busy ? 'SENDING…' : 'CONFIRM REJECT'}
            </button>
            <button
              type="button"
              onClick={() => {
                setRejecting(false);
                setReason('');
                setError('');
              }}
              disabled={busy}
              className="px-5 py-2.5 rounded-full text-[11px] font-semibold tracking-[0.12em] border disabled:opacity-40"
              style={{ borderColor: 'var(--auth-card-border-strong)', color: 'var(--auth-text)' }}
            >
              CANCEL
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NineNineNineTab({ requests, scoped }) {
  const year = new Date().getFullYear();
  const totals = useMemo(() => cumulativePayByContact(requests, { year }), [requests, year]);
  // W9 status is per-contact, not per-request, so pull it off the first
  // matching request row (the API decorates every row with it identically).
  const w9ByContact = useMemo(() => {
    const map = new Map();
    for (const r of requests) {
      if (!map.has(r.contact_id)) map.set(r.contact_id, r.w9_on_file);
    }
    return map;
  }, [requests]);

  return (
    <div>
      <p className="text-[12px] mb-5" style={{ color: 'var(--auth-muted)' }}>
        Cumulative pay per 1099 contractor for {year}, from paid requests only. Every total below will read $0 until
        Phase 4 connects Mercury payouts — that&rsquo;s expected, not a bug.
        {scoped ? ' These totals stay year-wide across every event, because that is what a 1099 reports.' : ''}
      </p>
      {totals.length === 0 ? (
        <p className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
          No paid requests yet for {year}.
        </p>
      ) : (
        <div className="space-y-2">
          {totals.map((t) => (
            <div key={t.contact_id} className="rounded-[10px] border p-4 flex items-center justify-between gap-3 flex-wrap" style={altCardStyle}>
              <div>
                <Link href={`/bananas/contacts/${t.contact_id}`} className="text-[14px] font-bold hover:underline" style={{ color: 'var(--auth-text-strong)' }}>
                  {t.contact_name}
                </Link>
                <div className="text-[12px] mt-0.5" style={{ color: 'var(--auth-muted)' }}>
                  {t.paid_count} paid request{t.paid_count === 1 ? '' : 's'}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className="text-[10px] font-semibold tracking-[0.12em] px-2.5 py-1 rounded-full"
                  style={
                    w9ByContact.get(t.contact_id) === true
                      ? { color: 'var(--auth-success)', background: 'var(--auth-success-bg)', border: '1px solid var(--auth-success-border)' }
                      : w9ByContact.get(t.contact_id) === false
                        ? { color: 'var(--auth-warn)', background: 'var(--auth-warn-bg)', border: '1px solid var(--auth-warn-border)' }
                        : { color: 'var(--auth-muted)', background: 'var(--auth-card-bg)', border: '1px solid var(--auth-card-border)' }
                  }
                >
                  {w9ByContact.get(t.contact_id) === true ? 'W9 ON FILE' : w9ByContact.get(t.contact_id) === false ? 'NO W9' : 'W9 UNKNOWN'}
                </span>
                <span className="text-[18px] font-bold" style={{ color: 'var(--auth-text-strong)' }}>
                  {formatMoney(t.total_cents)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// `eventId` scopes the review queue to one event (set from ?event= by the
// server page). The 1099 tab deliberately ignores it: a 1099 is a year-wide
// per-contractor total, so filtering it to one night would report a number that
// is wrong for the only purpose it has.
export default function PayRequestsClient({ eventId = null, eventTitle = null, eventMissing = false }) {
  const [requests, setRequests] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState('');
  const [tab, setTab] = useState('review');

  const load = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/pay-requests');
      setRequests(res.requests || []);
      setLoadError('');
    } catch (err) {
      setLoadError(err?.message || 'Could not load pay requests');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // One fetch, then filtered here rather than in the API: the 1099 tab needs the
  // unfiltered set on the same page load.
  const inScope = useMemo(
    () => (eventId ? (requests || []).filter((r) => r.event_id === eventId) : requests || []),
    [requests, eventId]
  );
  const pending = inScope.filter((r) => r.status === 'pending_review');
  const reviewed = inScope.filter((r) => r.status !== 'pending_review');

  const handleApprove = async (id) => {
    setBusyId(id);
    setActionError('');
    try {
      await adminFetch(`/api/admin/pay-requests/${id}/approve`, { method: 'POST' });
      await load();
    } catch (err) {
      setActionError(err?.message || 'Could not approve this request');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (id, rejectionReason) => {
    setBusyId(id);
    setActionError('');
    try {
      await adminFetch(`/api/admin/pay-requests/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejection_reason: rejectionReason }),
      });
      await load();
    } catch (err) {
      setActionError(err?.message || 'Could not reject this request');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-[12px] border p-5" style={cardStyle}>
      {eventMissing && (
        <p className="text-[13px] mb-4" style={{ color: 'var(--auth-danger)' }}>
          That event no longer exists, so there is nothing to scope to.{' '}
          <Link href="/bananas/pay-requests" className="underline">
            Show every pay request
          </Link>
          .
        </p>
      )}

      {eventId && !eventMissing && (
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <span
            className="text-[11px] font-semibold tracking-[0.12em] px-3 py-1.5 rounded-full"
            style={{
              color: 'var(--auth-accent)',
              background: 'var(--auth-card-bg-alt)',
              border: '1px solid var(--auth-card-border)',
            }}
          >
            THIS EVENT ONLY
          </span>
          <Link
            href="/bananas/pay-requests"
            className="text-[11px] font-semibold tracking-[0.12em] transition-colors hover:underline"
            style={{ color: 'var(--auth-muted)' }}
          >
            SHOW EVERY EVENT
          </Link>
        </div>
      )}

      <UnderlineTabs
        tabs={[
          { id: 'review', label: 'Review & Pay', count: pending.length },
          // No count: 1099 Tracking is a different view of the same data, not
          // a bucket that happens to be empty, so a "0" chip would mislead.
          { id: '1099', label: '1099 Tracking' },
        ]}
        active={tab}
        onChange={setTab}
        ariaLabel="Filter pay requests"
      />

      {loadError && (
        <p className="text-[13px]" style={{ color: 'var(--auth-danger)' }}>
          {loadError}
        </p>
      )}
      {!loadError && requests === null && (
        <p className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
          Loading…
        </p>
      )}

      {requests !== null && tab === 'review' && (
        <div>
          {actionError && (
            <p className="text-[13px] mb-4" style={{ color: 'var(--auth-danger)' }}>
              {actionError}
            </p>
          )}
          {pending.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
              {eventId
                ? `Nothing waiting on review for ${eventTitle || 'this event'}.`
                : 'Nothing waiting on review right now.'}
            </p>
          ) : (
            <div className="space-y-3">
              {pending.map((req) => (
                <RequestRow key={req.id} req={req} onApprove={handleApprove} onReject={handleReject} busy={busyId === req.id} />
              ))}
            </div>
          )}

          <details className="mt-8 group">
            <summary className="cursor-pointer list-none text-[12px] font-semibold tracking-[0.14em] py-3 select-none" style={{ color: 'var(--auth-muted)' }}>
              REVIEWED REQUESTS ({reviewed.length})
              <span className="ml-2 inline-block transition-transform group-open:rotate-90">›</span>
            </summary>
            <div className="space-y-2 mt-3">
              {reviewed.map((r) => (
                  <div key={r.id} className="rounded-[10px] border p-3 flex items-center justify-between gap-3 flex-wrap" style={altCardStyle}>
                    <div className="text-[13px]">
                      <span style={{ color: 'var(--auth-text-strong)', fontWeight: 600 }}>{r.contact?.display_name}</span>{' '}
                      <span style={{ color: 'var(--auth-muted)' }}>&middot; {r.event?.title} &middot; {formatMoney(r.amount_cents)}</span>
                    </div>
                    <span
                      className="text-[10px] font-semibold tracking-[0.12em] px-2.5 py-1 rounded-full"
                      style={
                        r.status === 'approved'
                          ? { color: 'var(--auth-success)', background: 'var(--auth-success-bg)', border: '1px solid var(--auth-success-border)' }
                          : { color: 'var(--auth-danger)', background: 'var(--auth-danger-bg)', border: '1px solid var(--auth-danger-border)' }
                      }
                    >
                      {payRequestStatusLabel(r.status).toUpperCase()}
                    </span>
                  </div>
                ))}
            </div>
          </details>
        </div>
      )}

      {requests !== null && tab === '1099' && (
        <NineNineNineTab requests={requests} scoped={Boolean(eventId)} />
      )}
    </section>
  );
}
