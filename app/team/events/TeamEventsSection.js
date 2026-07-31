'use client';

import { useState } from 'react';

// Read-only counterpart to app/bananas/components/EventsSection.js. Team
// members can see what's on the books, but there is no "+ NEW EVENT" button
// and no EDIT / delete controls here — creating, editing, and deleting events
// stays admin-only (enforced separately by RLS on public.events, see
// 20260727_rls_security_hardening.sql).
function formatDate(dateString) {
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function TeamEventsSection({ upcoming, past }) {
  const [tab, setTab] = useState('upcoming');
  const events = tab === 'upcoming' ? upcoming : past;

  return (
    <div>
      {/* Header + tabs */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-1 p-1 rounded-full" style={{ background: 'var(--auth-card-bg)', border: '1px solid var(--auth-card-border)' }}>
          <button
            onClick={() => setTab('upcoming')}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full text-[12px] font-semibold tracking-[0.12em] transition-all"
            style={{
              background: tab === 'upcoming' ? 'var(--auth-text-strong)' : 'transparent',
              color: tab === 'upcoming' ? 'var(--auth-strong-surface-text)' : 'var(--auth-muted)',
            }}
          >
            UPCOMING
            <span
              className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold"
              style={{
                background: tab === 'upcoming' ? 'var(--auth-accent)' : 'var(--auth-ghost-bg)',
                color: tab === 'upcoming' ? 'var(--auth-accent-text)' : 'var(--auth-muted)',
              }}
            >
              {upcoming.length}
            </span>
          </button>
          <button
            onClick={() => setTab('past')}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full text-[12px] font-semibold tracking-[0.12em] transition-all"
            style={{
              background: tab === 'past' ? 'var(--auth-text-strong)' : 'transparent',
              color: tab === 'past' ? 'var(--auth-strong-surface-text)' : 'var(--auth-muted)',
            }}
          >
            PAST
            <span
              className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold"
              style={{
                background: tab === 'past' ? 'var(--auth-card-bg-alt)' : 'var(--auth-ghost-bg)',
                color: tab === 'past' ? 'var(--auth-text)' : 'var(--auth-muted)',
              }}
            >
              {past.length}
            </span>
          </button>
        </div>
      </div>

      {/* Event list — view only, no edit/delete/create controls */}
      {events.length === 0 ? (
        <div className="rounded-[14px] p-10 text-center border" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
          <p className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
            {tab === 'upcoming' ? 'No upcoming events.' : 'No past events yet.'}
          </p>
        </div>
      ) : (
        <div className={`space-y-3 ${tab === 'past' ? 'opacity-70' : ''}`}>
          {events.map((event) => (
            <div key={event.id} className="rounded-[14px] border p-5 flex items-center gap-5" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
              <div className="w-20 h-20 rounded-[10px] overflow-hidden flex-shrink-0" style={{ background: 'var(--auth-card-bg-alt)' }}>
                {event.image_url && <img src={event.image_url} alt={event.title} className="w-full h-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] mb-1" style={{ color: 'var(--auth-muted)' }}>
                  {formatDate(event.event_date)}{event.event_time ? ` · ${event.event_time}` : ''}
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="text-[17px] font-bold truncate" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{event.title}</h3>
                  {event.status === 'draft' && (
                    <span
                      className="flex-shrink-0 text-[10px] font-semibold tracking-[0.12em] px-2 py-0.5 rounded-full"
                      style={{ color: 'var(--auth-accent-text)', background: 'var(--auth-accent)' }}
                    >
                      DRAFT
                    </span>
                  )}
                  {event.visibility === 'internal' && (
                    <span
                      className="flex-shrink-0 text-[10px] font-semibold tracking-[0.12em] px-2 py-0.5 rounded-full"
                      style={{ color: 'var(--auth-accent-text)', background: 'var(--auth-warn)' }}
                      title="Internal micro party — hidden from the public events page"
                    >
                      INTERNAL
                    </span>
                  )}
                </div>
                <div className="text-[12px] mt-1" style={{ color: 'var(--auth-faint)' }}>/events/{event.slug}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
