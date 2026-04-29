'use client';

import { useRouter } from 'next/navigation';

/**
 * Homepage events tile. Designed like a marquee poster:
 *  - The immediate next show is the hero (big date numerals, prominent
 *    ticket CTA) — that's the conversion point.
 *  - Subsequent shows sit quietly underneath as a thin schedule.
 * Clicking the tile background morphs into /events; clicking ticket
 * buttons goes straight to checkout (no transition).
 */
export default function EventsTile({ events = [] }) {
  const router = useRouter();
  const href = '/events';
  const transitionName = 'portal-events';

  const handleTileClick = (e) => {
    if (
      e.target.closest('a[data-ticket]') ||
      e.target.closest('a[data-allevents]') ||
      e.target.closest('button')
    )
      return;
    e.preventDefault();
    if (typeof document !== 'undefined' && document.startViewTransition) {
      document.startViewTransition(() => router.push(href));
    } else {
      router.push(href);
    }
  };

  const parseDate = (s) => (s ? new Date(s + 'T00:00:00') : null);
  const monthShort = (d) =>
    d ? d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase() : '';
  const day = (d) => (d ? String(d.getDate()).padStart(2, '0') : '');
  const weekday = (d) =>
    d ? d.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase() : '';

  const [feature, ...rest] = events;
  const featureDate = parseDate(feature?.event_date);
  const secondary = rest.slice(0, 2);

  return (
    <a
      href={href}
      onClick={handleTileClick}
      className="group relative block overflow-hidden rounded-[20px] border transition-all duration-500 ease-out hover:-translate-y-1 hover:border-white/20"
      style={{
        borderColor: 'rgba(255,255,255,0.08)',
        aspectRatio: '4 / 5',
        viewTransitionName: transitionName,
        backgroundImage:
          'radial-gradient(120% 80% at 50% 0%, rgba(70,55,90,0.55) 0%, rgba(20,18,28,0.95) 55%, rgba(8,8,12,1) 100%)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Soft hover bloom */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.06) 0%, transparent 55%)',
        }}
      />

      {/* Decorative film-grain noise via repeating gradient — very subtle */}
      <div
        className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-[0.08]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(255,255,255,0.5) 0 1px, transparent 1px 3px)',
        }}
      />

      <div className="relative h-full flex flex-col p-8 md:p-10">
        {/* Header */}
        <div className="flex items-baseline justify-between mb-auto">
          <div
            className="text-[10px] font-semibold tracking-[0.28em]"
            style={{ color: 'rgba(255,255,255,0.55)' }}
          >
            UPCOMING
          </div>
          <div
            className="text-[10px] font-semibold tracking-[0.24em]"
            style={{ color: 'rgba(255,255,255,0.35)' }}
          >
            {events.length > 0 ? `01 / ${String(events.length).padStart(2, '0')}` : ''}
          </div>
        </div>

        {/* Featured next show */}
        {feature ? (
          <div className="mt-8">
            {/* Date row: weekday · day */}
            <div className="flex items-end gap-5 mb-5">
              <div
                className="leading-none"
                style={{
                  fontFamily: "'Moshra Aesthetic', 'Cormorant Unicase', serif",
                  fontWeight: 400,
                  fontSize: 'clamp(72px, 10vw, 128px)',
                  color: '#ffffff',
                  letterSpacing: '-0.04em',
                }}
              >
                {day(featureDate)}
              </div>
              <div className="pb-2">
                <div
                  className="text-[11px] font-semibold tracking-[0.24em] mb-1"
                  style={{ color: 'rgba(255,255,255,0.55)' }}
                >
                  {monthShort(featureDate)}
                </div>
                <div
                  className="text-[11px] font-semibold tracking-[0.24em]"
                  style={{ color: 'rgba(255,255,255,0.35)' }}
                >
                  {weekday(featureDate)}
                </div>
              </div>
            </div>

            {/* Title */}
            <h3
              className="text-[20px] md:text-[22px] leading-[1.25] mb-5"
              style={{
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                fontWeight: 600,
                color: '#ffffff',
                letterSpacing: '-0.01em',
              }}
            >
              {feature.title}
            </h3>

            {/* Primary CTA */}
            {feature.ticket_url ? (
              <a
                data-ticket
                href={feature.ticket_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2.5 px-5 py-3 rounded-full text-[11px] font-semibold tracking-[0.2em] transition-all hover:-translate-y-0.5"
                style={{ background: '#ffffff', color: '#0a0a0a' }}
              >
                GET TICKETS
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="7" y1="17" x2="17" y2="7" />
                  <polyline points="7 7 17 7 17 17" />
                </svg>
              </a>
            ) : (
              <span
                className="inline-flex items-center gap-2.5 px-5 py-3 rounded-full text-[11px] font-semibold tracking-[0.2em] border"
                style={{
                  borderColor: 'rgba(255,255,255,0.25)',
                  color: 'rgba(255,255,255,0.7)',
                  background: 'rgba(255,255,255,0.04)',
                }}
              >
                MEMBERS ONLY
              </span>
            )}
          </div>
        ) : (
          <div className="mt-8">
            <p
              className="text-[15px] leading-[1.55]"
              style={{ color: 'rgba(255,255,255,0.7)' }}
            >
              No upcoming shows announced.
              <br />
              Check back soon.
            </p>
          </div>
        )}

        {/* Secondary schedule */}
        {secondary.length > 0 && (
          <ul
            className="mt-8 pt-5 space-y-1 border-t"
            style={{ borderColor: 'rgba(255,255,255,0.08)' }}
          >
            {secondary.map((ev) => {
              const d = parseDate(ev.event_date);
              return (
                <li key={ev.id ?? ev.slug ?? ev.title}>
                  {ev.ticket_url ? (
                    <a
                      data-ticket
                      href={ev.ticket_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-4 py-2.5 -mx-2 px-2 rounded-md transition-colors hover:bg-white/[0.04]"
                    >
                      <SecondaryRow d={d} title={ev.title} hasTicket />
                    </a>
                  ) : (
                    <div className="flex items-center gap-4 py-2.5 -mx-2 px-2">
                      <SecondaryRow d={d} title={ev.title} hasTicket={false} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* All events link */}
        <div className="mt-6 pt-5 flex items-center justify-end">
          <a
            data-allevents
            href={href}
            onClick={handleTileClick}
            className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em] transition-all duration-300 group-hover:gap-3"
            style={{ color: 'rgba(255,255,255,0.85)' }}
          >
            ALL EVENTS
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="7" y1="17" x2="17" y2="7" />
              <polyline points="7 7 17 7 17 17" />
            </svg>
          </a>
        </div>
      </div>
    </a>
  );
}

function SecondaryRow({ d, title, hasTicket }) {
  const monthShort = d
    ? d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
    : '';
  const day = d ? String(d.getDate()).padStart(2, '0') : '';
  return (
    <>
      <div
        className="flex items-baseline gap-1.5 w-[60px] flex-shrink-0 tabular-nums"
        style={{ color: 'rgba(255,255,255,0.55)' }}
      >
        <span
          className="text-[10px] font-semibold tracking-[0.2em]"
          style={{ color: 'rgba(255,255,255,0.45)' }}
        >
          {monthShort}
        </span>
        <span
          className="text-[14px] font-semibold"
          style={{ color: 'rgba(255,255,255,0.85)' }}
        >
          {day}
        </span>
      </div>
      <div
        className="flex-1 text-[13px] leading-[1.4] truncate"
        style={{
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          color: 'rgba(255,255,255,0.85)',
        }}
      >
        {title}
      </div>
      <div
        className="text-[10px] font-semibold tracking-[0.2em]"
        style={{ color: hasTicket ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)' }}
      >
        {hasTicket ? 'TICKETS →' : 'PRIVATE'}
      </div>
    </>
  );
}
