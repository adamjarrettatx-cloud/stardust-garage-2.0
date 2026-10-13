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
        <div className="flex items-center gap-1 p-1 rounded-[8px]" style={{ background: 'var(--auth-card-bg)', border: '1px solid var(--auth-card-border)' }}>
          <button
            onClick={() => setTab('upcoming')}
            className="flex items-center gap-2 px-4 py-1.5 rounded-[6px] text-[12px] font-semibold tracking-[0.12em] transition-all"
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
            className="flex items-center gap-2 px-4 py-1.5 rounded-[6px] text-[12px] font-semibold tracking-[0.12em] transition-all"
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
        <div className="flex flex-wrap items-center justify-end gap-4">
        <Link href="/bananas/orders" className="text-[12px] font-semibold" style={{ color: 'var(--auth-muted)' }}>
          ORDERS &amp; REFUNDS
        </Link>
        </div>
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
            <div key={event.id} className="rounded-[14px] border p-5 flex flex-wrap md:flex-nowrap items-center gap-5" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
              <div className="w-20 h-20 rounded-[10px] overflow-hidden flex-shrink-0" style={{ background: 'var(--auth-card-bg-alt)' }}>
                {event.image_url && <img src={event.image_url} alt={event.title} className="w-full h-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] mb-1" style={{ color: 'var(--auth-muted)' }}>
                  {formatDate(event.event_date)}{event.event_time ? ` · ${event.event_time}` : ''}
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="text-[17px] font-bold truncate" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{event.title}</h3>
                  {event.series_id && (
                    <Link
                      href={`/bananas/series/${event.series_id}`}
                      className="flex-shrink-0 text-[10px] font-semibold tracking-[0.12em] px-2 py-0.5 rounded-[8px] border"
                      style={{ color: 'var(--auth-accent)', borderColor: 'var(--auth-card-border)' }}
                      title="View series financial rollup"
                    >
                      {(event.series?.recurrence_freq === 'biweekly' ? 'BI-WEEKLY' : 'WEEKLY')} · #{event.recurrence_position || '—'}
                    </Link>
                  )}
                  {(event.status === 'draft' || event.visibility === 'internal') && (
                    <span
                      className="flex-shrink-0 text-[10px] font-semibold tracking-[0.12em] px-2 py-0.5 rounded-[6px]"
                      style={{ color: 'var(--auth-accent-text)', background: 'var(--auth-accent)' }}
                    >
                      DRAFT
                    </span>
                  )}
                  {event.visibility === 'unlisted' && (
                    <span
                      className="flex-shrink-0 text-[10px] font-semibold tracking-[0.12em] px-2 py-0.5 rounded-[6px]"
                      style={{ color: 'var(--auth-accent-text)', background: 'var(--auth-warn)' }}
                      title="Secret — reachable by its secret link only, not on the public events page"
                    >
                      SECRET
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
                  work with no equivalent global page. Contracts sits between
                  the live sales number and Guest List so the row reads
                  left-to-right in the order the owner needs it (money → docs
                  → door); the link deep-links to the event edit page's
                  #contracts section so a click lands directly on the Event
                  Contracts panel — the staff starting point for creating and
                  sending an agreement. The long label shortens below 640px
                  instead of wrapping the row onto a second line; both halves
                  ship in the markup so the label never depends on a JS width
                  guess and the full wording stays available to search and
                  screen readers. */}
              <EventTicketSalesLive
                eventId={event.id}
                hasTicketing={
                  event.ticketing_mode === 'internal' ||
                  Boolean(event.tt_event_series_id)
                }
                initialMetrics={metricsByEvent[event.id] || null}
              />
              {/* Row actions. Navigation destinations (Attendees & Orders,
                  Contracts, Guest List) are labelled 8px-radius buttons that
                  match the Orders & Refunds page; record actions on the event
                  itself (edit, delete) are a compact icon segmented control
                  pinned to the far right so they never wrap onto their own
                  line and the destructive action is visually separated from
                  navigation. */}
              <div className="flex items-center gap-3 flex-shrink-0 ml-auto">
                <div className="flex flex-wrap gap-2 justify-end max-w-[420px]">
                  {event.ticketing_mode === 'internal' && (
                    <Link
                      href={`/bananas/events/${event.id}/attendees`}
                      className="auth-theme-border-button sdg-row-btn"
                      title={`Attendees and orders for ${event.title}`}
                    >
                      ATTENDEES &amp; ORDERS
                    </Link>
                  )}
                  {/* SDG-only events have no counterparty to sign anything, so
                      the Contracts section is hidden on the edit page for those
                      (see app/bananas/events/[id]/page.js). Hiding the button
                      here too keeps the row honest — no dead deep-link into a
                      section that doesn't render. */}
                  {!event.is_sdg_only && (
                    <Link
                      href={`/bananas/events/${event.id}#contracts`}
                      className="auth-theme-border-button sdg-row-btn"
                      title={`Contracts for ${event.title}`}
                    >
                      CONTRACTS
                    </Link>
                  )}
                  <Link
                    href={`/bananas/guest-list/${event.id}`}
                    className="auth-theme-border-button sdg-row-btn"
                    title={`Guest list for ${event.title}`}
                  >
                    <span className="sm:hidden">GUESTS</span>
                    <span className="hidden sm:inline">GUEST LIST</span>
                  </Link>
                </div>
                <div className="sdg-row-icon-group" role="group" aria-label={`Manage ${event.title}`}>
                  <Link
                    href={`/bananas/events/${event.id}`}
                    className="sdg-row-icon-btn"
                    aria-label={`Edit ${event.title}`}
                    title="Edit event"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M16.9 3.6a2.1 2.1 0 0 1 3 3L8.5 18 4 19.5 5.5 15z" />
                      <path d="M14.5 6l3.5 3.5" />
                    </svg>
                  </Link>
                  <DeleteEventButton eventId={event.id} eventTitle={event.title} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
