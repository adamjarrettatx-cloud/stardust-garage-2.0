import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate, OWNER_EMAIL } from '@/lib/auth-helpers';
import { canManageStaff as staffAccess } from '@/lib/time-clock/access.mjs';
import { loadTotalView } from '@/lib/totalview-data';
import { resolveTotalViewRange } from '@/lib/totalview';
import TotalViewClient from './TotalViewClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'TotalView | Stardust Garage',
  robots: { index: false, follow: false },
};

// TotalView — the admin landing page. One aggregated read of every other
// admin page: what is waiting on the team, what is coming up, what happened,
// and the current totals. Every number links to the page that owns it.
//
// The layout gate already ran, but a Next.js layout does not re-run on
// client navigation, so the page gates itself too. Owner-only figures and
// staff hours are decided here on the server and simply absent from the
// payload for anyone else.
export default async function TotalViewPage({ searchParams }) {
  const { user, redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const params = await searchParams;
  const initialRange = resolveTotalViewRange(params?.range);
  const isOwner = user?.email === OWNER_EMAIL;
  const canManageStaff = staffAccess({ email: user?.email, isAdmin: true });

  const supabase = await createClient();
  const data = await loadTotalView({ supabase, isOwner, canManageStaff });

  return <TotalViewClient data={data} initialRange={initialRange} />;
}
