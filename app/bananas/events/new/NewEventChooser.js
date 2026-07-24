'use client';

import { useState } from 'react';
import Link from 'next/link';
import EventForm from '../../components/EventForm';
import TtEventCreator from '../../components/TtEventCreator';

// Lets the admin pick how to create a new event:
//   - "ticketed": create AND publish the website event together with a
//     TicketTailor event series (date/time occurrence + ticket types) in one go.
//   - "manual": the existing form (website event only, link an existing TT
//     series or external ticket URL by hand).
export default function NewEventChooser() {
  const [mode, setMode] = useState(null);

  if (mode === 'ticketed') return <TtEventCreator />;
  if (mode === 'manual') return <EventForm />;

  const cardStyle = { background: 'var(--surface-1)', borderColor: 'var(--fg-a08)' };

  return (
    <main className="max-w-[700px] mx-auto px-6 py-16">
      <Link
        href="/bananas"
        className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-8 transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-3)' }}
      >
        ← BACK TO ADMIN
      </Link>

      <h1
        className="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-3"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        New Event
      </h1>
      <p className="text-[13px] mb-10" style={{ color: 'var(--text-3)' }}>
        How do you want to create this event?
      </p>

      <div className="grid gap-4">
        <button
          type="button"
          onClick={() => setMode('ticketed')}
          className="text-left rounded-[14px] border p-6 transition-all hover:-translate-y-0.5 hover:border-white/20"
          style={cardStyle}
        >
          <div className="text-[17px] font-bold mb-1.5" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Ticketed event (TicketTailor)
          </div>
          <div className="text-[13px] leading-[1.6]" style={{ color: 'var(--text-3)' }}>
            Creates and publishes the website event and a TicketTailor event series together — date,
            times and ticket types included. Both go live immediately.
          </div>
        </button>

        <button
          type="button"
          onClick={() => setMode('manual')}
          className="text-left rounded-[14px] border p-6 transition-all hover:-translate-y-0.5 hover:border-white/20"
          style={cardStyle}
        >
          <div className="text-[17px] font-bold mb-1.5" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Manual / private event
          </div>
          <div className="text-[13px] leading-[1.6]" style={{ color: 'var(--text-3)' }}>
            The classic form — website event only. Link an existing TicketTailor series or paste an
            external ticket URL, or leave it as a private (no-ticket) event.
          </div>
        </button>
      </div>
    </main>
  );
}
