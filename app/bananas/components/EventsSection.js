'use client';

import { useState } from 'react';
import Link from 'next/link';
import DeleteEventButton from './DeleteEventButton';

function formatDate(dateString) {
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function EventsSection({ upcoming, past }) {
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
        <Link
          href="/bananas/events/new"
          className="auth-theme-solid-button px-6 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5"
        >
          + NEW EVENT
        </Link>
      </div>

      {/* Event list */}
      {events.length === 0 ? (
        <div className="rounded-[14px] p-10 text-center border" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
          <p className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
            {tab === 'upcoming' ? 'No upcoming events. Click "+ NEW EVENT" to create one.' : 'No past events yet.'}
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
              {/* Guest List and Artist Pay are per-event work, so they open
                  scoped to this event rather than to an all-events summary you
                  then have to search. They used to be People tiles, which is
                  exactly the trip this removes. */}
              <div className="flex flex-wrap gap-2 justify-end flex-shrink-0">
                <Link
                  href={`/bananas/guest-list/${event.id}`}
                  className="auth-theme-border-button px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors"
                  title={`Guest list for ${event.title}`}
                >
                  GUEST LIST
                </Link>
                <Link
                  href={`/bananas/pay-requests?event=${event.id}`}
                  className="auth-theme-border-button px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors"
                  title={`Artist pay for ${event.title}`}
                >
                  ARTIST PAY
                </Link>
                <Link
                  href={`/bananas/events/${event.id}`}
                  className="auth-theme-border-button px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors"
                >
                  EDIT
                </Link>
                <DeleteEventButton eventId={event.id} eventTitle={event.title} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
