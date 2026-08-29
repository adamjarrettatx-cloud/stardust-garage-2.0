import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate, OWNER_EMAIL } from '@/lib/auth-helpers';
import { fetchAdminCounts } from '@/lib/admin-counts';
import AdminShell from './AdminShell';

export const revalidate = 0;

// ---------------------------------------------------------------------------
// Admin shell layout
// ---------------------------------------------------------------------------
// The header and section sidebar live here rather than on the dashboard page so
// they persist across navigation: opening Contacts from the People section swaps
// only the content column instead of replacing the whole screen with a page you
// then have to back out of.
//
// Sidebar counts are fetched once here, so they stay accurate on every admin
// route rather than only on the dashboard.
//
// Note on gating: this gate is the floor (any admin), not the ceiling. Pages
// with stricter requirements still run their own ownerPageGate() /
// requireTeam() — a layout in Next.js does not re-run on client-side navigation
// between child routes, so it must never be the only thing standing between a
// user and owner-only data.
export default async function BananasLayout({ children }) {
  const { user, redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const counts = await fetchAdminCounts(supabase);

  return (
    <AdminShell
      userEmail={user?.email}
      isOwner={user?.email === OWNER_EMAIL}
      counts={counts}
    >
      {children}
    </AdminShell>
  );
}
