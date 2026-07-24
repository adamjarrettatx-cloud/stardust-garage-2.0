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
        <div className="flex items-center gap-1 p-1 rounded-full" style={{ background: 'var(--surface-1)', border: '1px solid var(--fg-a07)' }}>
          <button
            onClick={() => setTab('upcoming')}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full text-[12px] font-semibold tracking-[0.12em] transition-all"
            style={{
              background: tab === 'upcoming' ? '#ffffff' : 'transparent',
              color: tab === 'upcoming' ? '#0a0a0a' : 'var(--text-3)',
            }}
          >
            UPCOMING
            <span
              className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold"
              style={{
                background: tab === 'upcoming' ? 'var(--st-ffb84d)' : 'rgba(255,255,255,0.1)',
                color: tab === 'upcoming' ? '#0a0a0a' : 'var(--text-3)',
              }}
            >
              {upcoming.length}
            </span>
          </button>
          <button
            onClick={() => setTab('past')}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full text-[12px] font-semibold tracking-[0.12em] transition-all"
            style={{
              background: tab === 'past' ? '#ffffff' : 'transparent',
              color: tab === 'past' ? '#0a0a0a' : 'var(--text-3)',
            }}
          >
            PAST
            <span
              className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold"
              style={{
                background: tab === 'past' ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.1)',
                color: tab === 'past' ? 'var(--text-4)' : 'var(--text-3)',
              }}
            >
              {past.length}
            </span>
          </button>
        </div>
        <Link
          href="/bananas/events/new"
          className="px-6 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5"
          style={{ background: '#ffffff', color: '#0a0a0a' }}
        >
          + NEW EVENT
        </Link>
      </div>

      {/* Event list */}
      {events.length === 0 ? (
        <div className="rounded-[14px] p-10 text-center border" style={{ background: 'var(--surface-1)', borderColor: 'var(--fg-a05)' }}>
          <p className="text-[13px]" style={{ color: 'var(--text-4)' }}>
            {tab === 'upcoming' ? 'No upcoming events. Click "+ NEW EVENT" to create one.' : 'No past events yet.'}
          </p>
        </div>
      ) : (
        <div className={`space-y-3 ${tab === 'past' ? 'opacity-70' : ''}`}>
          {events.map((event) => (
            <div key={event.id} className="rounded-[14px] border p-5 flex items-center gap-5" style={{ background: 'var(--surface-1)', borderColor: 'var(--fg-a05)' }}>
              <div className="w-20 h-20 rounded-[10px] overflow-hidden flex-shrink-0 bg-[var(--surface-4)]">
                {event.image_url && <img src={event.image_url} alt={event.title} className="w-full h-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] mb-1" style={{ color: 'var(--text-3)' }}>
                  {formatDate(event.event_date)}{event.event_time ? ` · ${event.event_time}` : ''}
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="text-[17px] font-bold truncate" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{event.title}</h3>
                  {event.status === 'draft' && (
                    <span
                      className="flex-shrink-0 text-[10px] font-semibold tracking-[0.12em] px-2 py-0.5 rounded-full"
                      style={{ color: '#0a0a0a', background: 'var(--st-ffb84d)' }}
                    >
                      DRAFT
                    </span>
                  )}
                  {event.visibility === 'internal' && (
                    <span
                      className="flex-shrink-0 text-[10px] font-semibold tracking-[0.12em] px-2 py-0.5 rounded-full"
                      style={{ color: '#0a0a0a', background: 'var(--st-f59e0b)' }}
                      title="Internal micro party — hidden from the public events page"
                    >
                      INTERNAL
                    </span>
                  )}
                </div>
                <div className="text-[12px] mt-1" style={{ color: 'var(--text-4)' }}>/events/{event.slug}</div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <Link
                  href={`/bananas/events/${event.id}`}
                  className="px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors hover:bg-white/5"
                  style={{ borderColor: 'var(--fg-a15)', color: 'var(--text-1)' }}
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
