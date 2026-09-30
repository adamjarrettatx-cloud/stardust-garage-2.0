import { redirect } from 'next/navigation';
import { requireSecurityOrTeam } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import SecurityClient from './SecurityClient';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Security · Stardust Garage', robots: { index: false, follow: false } };
export default async function SecurityPage() {
  const { user, unauthorized, station } = await requireSecurityOrTeam();
  if (unauthorized) redirect('/team/login');
  if (station) return <SecurityClient staffLabel={`${station.label} · Shared station`} stationMode />;
  const db = await createClient();
  const { data } = await db.from('team_members').select('full_name').eq('user_id', user.id).maybeSingle();
  return <SecurityClient staffLabel={data?.full_name || user.email || 'Staff'} />;
}
