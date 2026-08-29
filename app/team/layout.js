import { createClient } from '@/lib/supabase/server';
import { OWNER_EMAIL } from '@/lib/auth-helpers';
import { fetchAdminCounts } from '@/lib/admin-counts';
import AdminShell from '@/app/bananas/AdminShell';

export const revalidate = 0;

// ---------------------------------------------------------------------------
// Team layout
// ---------------------------------------------------------------------------
// Tasks and Chat are each a section of their own in the admin sidebar, but both
// live under /team because non-admin team members use the same pages.
// (The calendar used to be a Team tile; it is now the Events Calendar at the
// top of the Events section, and /team/calendar serves non-admin team members
// only.) So the admin shell is applied conditionally rather than
// unconditionally:
//
//   admin, on a route in an admin section -> wrap in the shell, sidebar and all
//   anyone else, or any other route       -> render the page exactly as before
//
// The second case matters in three ways. A non-admin team member must never see
// the admin sidebar — it lists Memberships, Analytics and Settings, none of
// which they can open. /team/login must stay reachable with no session at all,
// so this layout deliberately never redirects. And /team/documents belongs to
// no section, so `tileRequired` leaves it untouched.
//
// This is presentation only. Every page underneath keeps its own auth check and
// its own redirect; a layout does not re-run on client-side navigation between
// child routes, so it can never be relied on for access control.
export default async function TeamLayout({ children }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return children;

  const { data: teamMember } = await supabase
    .from('team_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (teamMember?.role !== 'admin') return children;

  const counts = await fetchAdminCounts(supabase);

  return (
    <AdminShell
      userEmail={user.email}
      isOwner={user.email === OWNER_EMAIL}
      counts={counts}
      tileRequired
    >
      {children}
    </AdminShell>
  );
}
