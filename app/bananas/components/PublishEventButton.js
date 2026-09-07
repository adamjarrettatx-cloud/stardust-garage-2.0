'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';

// Status panel for the event editor. For a DRAFT event it shows a "Publish"
// action that flips the website event to 'published' so it appears on the
// public /events page. Two legacy events still have a linked TicketTailor
// series — for those, the same server route also flips the TT series to
// 'published' so their tickets go on sale. New/future events don't touch TT.
//
// The publish itself runs in /api/admin/events/:id/tt-publish (admin + MFA
// gated). The TICKETTAILOR_API_KEY is never exposed to the browser.
export default function PublishEventButton({ eventId, status, ttEventSeriesId }) {
  const router = useRouter();
  const [publishing, setPublishing] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [current, setCurrent] = useState(status || 'draft');

  const isDraft = current === 'draft';

  async function publish() {
    setPublishing(true);
    setMsg('');
    setError('');
    try {
      const res = await adminFetch(`/api/admin/events/${eventId}/tt-publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      setCurrent(res.status || 'published');
      if (res.ttNote) {
        setMsg(res.ttNote);
      } else if (res.ttPublished) {
        // Legacy: this event still has a linked TicketTailor series.
        setMsg('Website event published and its ticket series is now on sale.');
      } else {
        setMsg('Website event published.');
      }
      router.refresh();
    } catch (err) {
      setError(err?.message || 'Publish failed');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div
      className="rounded-[12px] border p-5 mb-6"
      style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-[12px] font-semibold tracking-[0.14em]" style={{ color: 'var(--auth-muted)' }}>
            STATUS
          </span>
          <span
            className="text-[11px] font-semibold tracking-[0.12em] px-2.5 py-1 rounded-full"
            style={{
              color: isDraft ? 'var(--auth-accent-text)' : 'var(--auth-strong-surface-text)',
              background: isDraft ? 'var(--auth-accent)' : 'var(--auth-success)',
            }}
          >
            {isDraft ? 'DRAFT' : 'PUBLISHED'}
          </span>
        </div>

        {isDraft && (
          <button
            type="button"
            onClick={publish}
            disabled={publishing}
            className="px-6 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5 disabled:opacity-40"
            style={{ background: 'var(--auth-success)', color: 'var(--auth-strong-surface-text)' }}
          >
            {publishing ? 'GOING LIVE…' : 'GO LIVE'}
          </button>
        )}
      </div>

      <p className="text-[11px] mt-3" style={{ color: 'var(--auth-muted)' }}>
        {isDraft
          ? ttEventSeriesId
            // Legacy TicketTailor-linked event.
            ? 'This event is a draft. Going live puts it on the public events page and sets its linked ticket series on sale.'
            : 'This event is a draft. Going live puts it on the public events page.'
          : 'This event is live on the public events page.'}
      </p>

      {msg && (
        <p className="text-[13px] mt-3" style={{ color: 'var(--auth-success-strong)' }}>
          {msg}
        </p>
      )}
      {error && (
        <p className="text-[13px] mt-3" style={{ color: 'var(--auth-danger)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
