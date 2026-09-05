'use client';

import { useSearchParams } from 'next/navigation';
import { resolveRootAdminTab } from '@/lib/admin-tabs';
import EventsCalendarClient from '@/app/components/EventsCalendarClient';
import EventsSection from './components/EventsSection';

// ---------------------------------------------------------------------------
// Events section content
// ---------------------------------------------------------------------------
// The EVENTS list used to sit below the tile grid on the dashboard root, which
// meant it followed you into every section — you saw it under Team, under
// Rentals, under Documents. It now belongs to one section of its own: Events,
// directly under Team in OPERATIONS.
//
// The Events Calendar sits above that list, so opening Events shows the whole
// programme in calendar view first and the record-by-record list second. The
// calendar used to sit in the Team section under a name that implied it was
// about who is working when. It never was — it is the business's programming
// calendar, which makes Events the section it belongs to.
//
// Events is list-backed rather than tile-backed (see `rendersOwnContent` in
// lib/admin-tabs.js), so there is no tile grid for it and this is the section.
// Which section is showing is client state owned by AdminShell and mirrored in
// ?tab=, so the check has to happen on the client — the server can read the
// query param but not a later in-page section switch, which the shell does
// with pushState rather than a navigation.
//
// `isOwner` has to come in as a prop, not be inferred here: owner-only sections
// (Analytics, Settings) resolve back to the default — Events — when the
// resolver thinks the viewer is not an owner, and without this the calendar
// bled through under Analytics for the actual owner. `resolveRootAdminTab`
// mirrors what AdminShell does for the dashboard root, so the two agree on
// which section is showing.
export default function EventsTabPanel({
  upcoming,
  past,
  calendar,
  isOwner,
  metricsByEvent,
}) {
  const searchParams = useSearchParams();
  const activeTab = resolveRootAdminTab(searchParams?.get('tab'), { isOwner });
  if (activeTab !== 'events') return null;

  return (
    <>
      {calendar && <EventsCalendarClient variant="section" {...calendar} />}
      <EventsSection upcoming={upcoming} past={past} metricsByEvent={metricsByEvent} />
    </>
  );
}
