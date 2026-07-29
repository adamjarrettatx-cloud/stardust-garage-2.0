import { redirect } from 'next/navigation';
import { requireTeam } from '@/lib/auth-helpers';
import GuestListDoorClient from './GuestListDoorClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Guest List · Door',
  other: { 'theme-color': '#0a0a0a' },
};

// Same kiosk viewport lock as the capacity door pages: no pinch zoom on a
// tablet that gets handed around, and viewport-fit=cover so the safe-area
// padding in the client takes effect.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0a0a0a',
};

// Unlike /capacity/front-door this page has NO device-token mode: every write it
// makes is attributed to a person (event_guestlist_entries.checked_in_by is a
// team_members id, guestlist_audit_log.actor_id is an auth user) and it shows
// staff-only guest contact details. A shared device token has no person behind
// it, so normal team login is the right gate — which is also what the
// "Team can manage all entries" RLS policy already assumes. Middleware already
// enforces the team role on /capacity/*; this is the second check.
export default async function GuestListDoorPage() {
  const { unauthorized } = await requireTeam();
  if (unauthorized) redirect('/team/login');

  return <GuestListDoorClient />;
}
