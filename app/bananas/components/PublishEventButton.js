'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';

// Status panel for the event editor. For a DRAFT event it shows a "Publish"
// action that takes both sides live at once: it publishes the linked
// TicketTailor event series (server-side) and flips the website event to
// 'published' so it appears on the public /events page. For an already
// published event it just shows the published badge.
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
        setMsg('Published — website event is live and the TicketTailor series is now on sale.');
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
      style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.08)' }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-[12px] font-semibold tracking-[0.14em]" style={{ color: '#8a8a8a' }}>
            STATUS
          </span>
          <span
            className="text-[11px] font-semibold tracking-[0.12em] px-2.5 py-1 rounded-full"
            style={{
              color: isDraft ? '#0a0a0a' : '#0f1a12',
              background: isDraft ? '#ffb84d' : '#4ade80',
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
            style={{ background: '#4ade80', color: '#0a0a0a' }}
          >
            {publishing ? 'PUBLISHING…' : 'PUBLISH WEBSITE + TICKETTAILOR'}
          </button>
        )}
      </div>

      <p className="text-[11px] mt-3" style={{ color: '#555' }}>
        {isDraft
          ? ttEventSeriesId
            ? 'Publishing makes this event public and sets its TicketTailor series to "published" so tickets go on sale.'
            : 'Publishing makes this event public. No TicketTailor series is linked, so only the website event is published.'
          : 'This event is live on the public events page.'}
      </p>

      {msg && (
        <p className="text-[13px] mt-3" style={{ color: '#86efac' }}>
          {msg}
        </p>
      )}
      {error && (
        <p className="text-[13px] mt-3" style={{ color: '#ff8080' }}>
          {error}
        </p>
      )}
    </div>
  );
}
