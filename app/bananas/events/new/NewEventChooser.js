'use client';

import { useState } from 'react';
import EventForm from '../../components/EventForm';
import TtEventCreator from '../../components/TtEventCreator';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

// Lets the admin pick how to create a new event:
//   - "ticketed": create AND publish the website event together with a
//     TicketTailor event series (date/time occurrence + ticket types) in one go.
//   - "manual": the existing form (website event only, link an existing TT
//     series or external ticket URL by hand).
export default function NewEventChooser() {
  const [mode, setMode] = useState(null);

  if (mode === 'ticketed') return <TtEventCreator />;
  if (mode === 'manual') return <EventForm />;

  const cardStyle = { background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' };

  return (
    <div className="max-w-[700px]">
      <AuthenticatedPageHeader
        backHref="/bananas?tab=events"
        backLabel="← BACK TO ADMIN"
        title="New Event"
        description="How do you want to create this event?"
        titleClassName="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1]"
        className="mb-10"
      />

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
          <div className="text-[13px] leading-[1.6]" style={{ color: 'var(--auth-muted)' }}>
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
          <div className="text-[13px] leading-[1.6]" style={{ color: 'var(--auth-muted)' }}>
            The classic form — website event only. Link an existing TicketTailor series or paste an
            external ticket URL, or leave it as a private (no-ticket) event.
          </div>
        </button>
      </div>
    </div>
  );
}
