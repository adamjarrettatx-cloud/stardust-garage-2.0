'use client';

import { useState } from 'react';
import Link from 'next/link';
import DeleteEventButton from './DeleteEventButton';
import EventTicketSalesLive from './EventTicketSalesLive';

function formatDate(dateString) {
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// `metricsByEvent` is a plain map of event.id -> cached TicketTailor metrics
// row from public.event_ticket_metrics. It comes from the server component
// (app/bananas/page.js) so the initial render already has the number — the
// live refresh button under the number re-pulls TicketTailor for just that
// event and updates in place without leaving the list.
export default function EventsSection({ upcoming, past, metricsByEvent = {} }) {
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
        {/* Creating an event happens from the events calendar day-click flow,
            which handles both internal and public (ticketed) events. Direct
            '+ New Event' entry point intentionally removed so there is only
            one create path. */}
        <Link
          href="/bananas/calendar"
          className="text-[12px] font-semibold tracking-[0.14em] transition-colors"
          style={{ color: 'var(--auth-muted)' }}
        >
          + NEW EVENT → CALENDAR
        </Link>
      </div>

      {/* Event list */}
      {events.length === 0 ? (
        <div className="rounded-[14px] p-10 text-center border" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
          <p className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
            {tab === 'upcoming' ? 'No upcoming events. Head to the calendar and click a day to add one.' : 'No past events yet.'}
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
              {/* Live ticket sales for the event sit where the per-event pay
                  button used to be, so the owner can read the number at a
                  glance without opening Ticket Tailor or a separate analytics
                  screen. The pay-request queue moved to its own MONEY sidebar
                  tab (see lib/admin-tabs.js) so a per-event button here would
                  only duplicate a destination that is already one click from
                  anywhere. Guest List stays on the row because it is per-event
                  work with no equivalent global page. The long label shortens
                  below 640px instead of wrapping the row onto a second line;
                  both halves ship in the markup so the label never depends on
                  a JS width guess and the full wording stays available to
                  search and screen readers. */}
              <EventTicketSalesLive
                eventId={event.id}
                hasTicketTailor={Boolean(event.tt_event_series_id)}
                initialMetrics={metricsByEvent[event.id] || null}
              />
              <div className="flex flex-wrap gap-2 justify-end flex-shrink-0">
                <Link
                  href={`/bananas/guest-list/${event.id}`}
                  className="auth-theme-border-button px-3 sm:px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors"
                  title={`Guest list for ${event.title}`}
                >
                  <span className="sm:hidden">GUESTS</span>
                  <span className="hidden sm:inline">GUEST LIST</span>
                </Link>
                <Link
                  href={`/bananas/events/${event.id}`}
                  className="auth-theme-border-button px-3 sm:px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors"
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
