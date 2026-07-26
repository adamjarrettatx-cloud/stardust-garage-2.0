'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import { centsToUsd } from '@/lib/event-analytics';

// Owner-only trigger for the ONE-TIME historical order backfill.
//
// ticket_order_attribution only holds rows the live webhook wrote from
// 2026-07-25 onward, which is why the chart above reads $0 before then. This
// pulls the missing Feb–Jul orders straight from TicketTailor.
//
// Deliberately two steps: the first click is always a dry run, and writing
// requires a second, explicit confirmation against the numbers it reported.
// The insert itself is ON CONFLICT (tt_order_id) DO NOTHING, so a stray repeat
// is harmless — the confirmation exists to stop a surprising run, not to make
// the write safe.
export default function BackfillTTOrdersButton({ t }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);

  async function run(dryRun) {
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/backfill-tt-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      });
      if (dryRun) {
        setPreview(res);
      } else {
        setDone(res);
        setPreview(null);
        router.refresh();
      }
    } catch (err) {
      setError(err?.message || 'Backfill failed');
    } finally {
      setBusy(false);
    }
  }

  const muted = t?.muted || '#8a8a8a';
  const strong = t?.mutedStrong || '#c8c8c8';

  if (done) {
    return (
      <div className="text-[12px]" style={{ color: muted }}>
        <span style={{ color: strong }}>Backfill completed</span>{' '}
        {new Date(done.finishedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} —{' '}
        {done.inserted} inserted, {done.alreadyPresent} already present
        {done.dateRange && <> · {done.dateRange.first} .. {done.dateRange.last}</>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => run(true)}
          disabled={busy}
          className="text-[12px] font-semibold tracking-[0.10em] uppercase rounded-[10px] px-4 py-2 transition-colors disabled:opacity-50"
          style={{ background: '#ffb84d', color: '#141414' }}
        >
          {busy && !preview ? 'Checking…' : 'Backfill historical TT orders (one-time)'}
        </button>
        {error && <span className="text-[12px]" style={{ color: '#f87171' }}>{error}</span>}
      </div>

      {preview && (
        <div className="text-[12px] flex flex-col gap-2" style={{ color: muted }}>
          <span>
            Dry run — nothing written. Fetched {preview.fetched}, would insert{' '}
            <span style={{ color: strong }}>{preview.selected}</span> ({preview.completed} completed worth{' '}
            {centsToUsd(preview.grossCents)}), {preview.outOfWindow} outside window, {preview.unusable} unusable.
            {preview.dateRange
              ? <> Range <span style={{ color: strong }}>{preview.dateRange.first} .. {preview.dateRange.last}</span> (Austin time).</>
              : ' No rows in range.'}
            {preview.hitPageCap && ' WARNING: hit the pagination cap — older orders may remain unfetched.'}
          </span>
          <span>
            Confirm the range starts in early February. If it starts in July, the API returned nothing
            older and writing will not fix the chart.
          </span>
          {preview.selected > 0 && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => run(false)}
                disabled={busy}
                className="text-[11px] font-semibold tracking-[0.10em] uppercase rounded-[8px] px-3 py-1.5 transition-colors disabled:opacity-50"
                style={{ background: '#4ade80', color: '#141414' }}
              >
                {busy ? 'Writing…' : 'Confirm — write to database'}
              </button>
              <button
                type="button"
                onClick={() => setPreview(null)}
                disabled={busy}
                className="text-[11px] tracking-[0.10em] uppercase underline disabled:opacity-50"
                style={{ color: muted }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
