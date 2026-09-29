import { redirect } from 'next/navigation';
import { requireFrontDeskOrTeam } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import SecurityClient from './SecurityClient';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Security · Stardust Garage', robots: { index: false, follow: false } };
export default async function SecurityPage() {
  const { user, unauthorized } = await requireFrontDeskOrTeam();
  if (unauthorized) redirect('/team/login');
  const db = await createClient();
  const { data } = await db.from('team_members').select('full_name').eq('user_id', user.id).maybeSingle();
  return <SecurityClient staffLabel={data?.full_name || user.email || 'Staff'} />;
}
