'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import EventForm from '../../components/EventForm';

// Creating a new event now goes straight into the standard EventForm.
//
// Historically this file offered two paths:
//   - "ticketed": create AND publish the website event together with a
//     TicketTailor event series in one go (<TtEventCreator />).
//   - "manual":   the classic form (website event only).
//
// We no longer sell tickets through TicketTailor, so the ticketed/TT path
// was removed. New events are always created via the manual form and sell
// tickets through our internal checkout (configured on the Ticketing panel).
// The two legacy TicketTailor-linked events keep working through their own
// event editor — nothing here touches them.
function NewEventChooserInner() {
  return (
    <div>
      {/* Back trail: landing on the default admin section after leaving a
          create-event page was the original UX bug. Keep an explicit link
          back to /bananas?tab=events so admins land on the Events tab. */}
      <div className="mb-6">
        <Link
          href="/bananas?tab=events"
          className="text-[11px] font-semibold tracking-[0.14em]"
          style={{ color: 'var(--auth-muted)' }}
        >
          ← BACK TO EVENTS
        </Link>
      </div>
      <EventForm />
    </div>
  );
}

export default function NewEventChooser() {
  // useSearchParams inside EventForm may require a Suspense boundary in the
  // App Router; keep one here so the page stays SSR-safe.
  return (
    <Suspense fallback={null}>
      <NewEventChooserInner />
    </Suspense>
  );
}
