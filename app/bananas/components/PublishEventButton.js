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
export default function PublishEventButton({ eventId, slug, status, ttEventSeriesId, visibility = 'public', embedded = false, controls = null }) {
  const router = useRouter();
  const [publishing, setPublishing] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [current, setCurrent] = useState(status || 'draft');

  const isDraft = current === 'draft';
  // Visibility 'internal' is labelled "Draft" in the editor: team-only, never
  // public. It cannot go live until Visibility is changed to Public or Secret.
  const isTeamOnly = visibility === 'internal';

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

  // Matches the 8px-radius, 36px-tall .sdg-row-btn used on the Events list.
  const buttonBase = 'sdg-row-btn';
  const labelCls = 'block text-[11px] font-semibold tracking-[0.14em] mb-1.5';

  // One row: Status | (Visibility, Event Type passed in as `controls`) | actions.
  // Every group is a small label over a 38px-tall control so the row lines up
  // on a shared baseline and wraps cleanly on narrow screens.
  const content = (
    <>
      <div className="flex items-end gap-x-7 gap-y-4 flex-wrap">
        <div>
          <label className={labelCls} style={{ color: 'var(--auth-muted)' }}>Status</label>
          <div className="h-[36px] flex items-center">
            <span
              className="h-[28px] inline-flex items-center text-[10px] font-semibold tracking-[0.12em] px-2.5 rounded-[6px]"
              style={{
                color: isDraft ? 'var(--auth-accent-text)' : 'var(--auth-strong-surface-text)',
                background: isDraft ? 'var(--auth-accent)' : 'var(--auth-success)',
              }}
            >
              {isDraft ? 'DRAFT' : 'PUBLISHED'}
            </span>
          </div>
        </div>

        {controls}

        <div className="ml-auto h-[36px] flex items-center gap-2">
          {/* Preview opens the exact public event page in a new tab, gated to
              admins by /events/[slug]/preview. */}
          {slug && (
            <a
              href={`/events/${slug}/preview`}
              target="_blank"
              rel="noopener noreferrer"
              className={`auth-theme-border-button ${buttonBase}`}
            >
              PREVIEW
            </a>
          )}
          {isDraft && !isTeamOnly && (
            <button
              type="button"
              onClick={publish}
              disabled={publishing}
              title={ttEventSeriesId ? 'Also puts the linked ticket series on sale.' : undefined}
              className={`${buttonBase} disabled:opacity-40`}
              style={{ background: 'var(--auth-success)', borderColor: 'var(--auth-success)', color: 'var(--auth-strong-surface-text)' }}
            >
              {publishing ? 'GOING LIVE…' : 'GO LIVE'}
            </button>
          )}
        </div>
      </div>

      {msg && (
        <p className="text-[12px] mt-2.5" style={{ color: 'var(--auth-success-strong)' }}>
          {msg}
        </p>
      )}
      {error && (
        <p className="text-[12px] mt-2.5" style={{ color: 'var(--auth-danger)' }}>
          {error}
        </p>
      )}
    </>
  );

  // Embedded: rendered as the header strip of the editor's top control card,
  // which owns the surrounding border and padding.
  if (embedded) return content;

  return (
    <div
      className="rounded-[12px] border p-5 mb-6"
      style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
    >
      {content}
    </div>
  );
}
