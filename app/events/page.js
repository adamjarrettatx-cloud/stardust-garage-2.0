import Link from 'next/link';

export const metadata = {
  title: 'Events — Stardust Garage',
};

export default function EventsIndexPage() {
  return (
    <main
      className="max-w-[1100px] mx-auto px-6 py-20"
      style={{ viewTransitionName: 'portal-events' }}
    >
      <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <div
            className="text-[11px] font-semibold tracking-[0.28em] mb-4"
            style={{ color: 'rgba(255,255,255,0.5)' }}
          >
            UPCOMING
          </div>
          <h1
            className="text-[28px] md:text-[40px] font-extrabold -tracking-[0.02em] leading-[1.05]"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Events
          </h1>
        </div>
        <Link
          href="https://www.tickettailor.com/events/stardustgarageatx"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-semibold tracking-[0.2em] inline-flex items-center gap-2 transition-colors hover:text-white"
          style={{ color: 'rgba(255,255,255,0.7)' }}
        >
          OPEN BOX OFFICE
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
        </Link>
      </div>

      {/*
        Tickets are sold and managed through Ticket Tailor. We embed the live
        box office below so the listing always matches what's actually for
        sale — no second source of truth to keep in sync.
      */}
      <div
        className="rounded-[16px] overflow-hidden border bg-white"
        style={{ borderColor: 'rgba(255,255,255,0.08)' }}
      >
        <iframe
          src="https://www.tickettailor.com/events/stardustgarageatx"
          title="Stardust Garage events on Ticket Tailor"
          className="w-full block"
          style={{ height: '1400px', border: 0 }}
          loading="lazy"
        />
      </div>
    </main>
  );
}
