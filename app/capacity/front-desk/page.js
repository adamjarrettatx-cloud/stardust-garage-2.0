import { redirect } from 'next/navigation';
import { requireTeam } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import FrontDeskClient from './FrontDeskClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Front Desk · Stardust Garage',
  robots: { index: false, follow: false },
  other: { 'theme-color': '#0a0a0a' },
};

// /capacity/front-desk
//
// The single laptop page the front-door attendant works from. Sits alongside
// the two Jelly2 kiosk pages (/capacity/front-door, /capacity/exit-door) and
// the tablet page (/capacity/guest-list) — same auth, same middleware gate,
// same design language — but tuned for a full laptop viewport rather than
// a 3.0" phone or a handheld tablet.
//
// Composes existing surfaces rather than replacing them:
//   * top strip     — live capacity read from the capacity_sessions row
//   * left panel    — guest list check-in (event picker + name search)
//   * right panel   — issue a trial pass (front-desk override, no SMS step)
//
// Explicitly OUT of scope for this build (belongs on the iPad kiosk later):
//   * trial pass QR scan check-in
//   * member QR scan check-in
//   * signature capture for first-time guests
//
// The attendant is a logged-in team member; the page is chrome-free (no admin
// shell) because it lives in the /capacity area with the other station pages.
export default async function FrontDeskPage() {
  const { user, unauthorized } = await requireTeam();
  if (unauthorized) redirect('/team/login');

  // Small nicety: show which team member is on shift in the header so the
  // captured "created_by" on any trial pass / audit trail is obvious to the
  // attendant. Falls back to email when the team_members row hasn't been
  // populated yet.
  const supabase = await createClient();
  const { data: teamMember } = await supabase
    .from('team_members')
    .select('full_name')
    .eq('user_id', user.id)
    .maybeSingle();

  const staffLabel = teamMember?.full_name || user.email || 'Front desk';

  return <FrontDeskClient staffLabel={staffLabel} staffEmail={user.email || null} />;
}
