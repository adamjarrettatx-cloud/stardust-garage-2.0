import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import RegisterClient from './RegisterClient';

export const revalidate = 0;

// Team-accessible POS register. Mirrors the gating used by /team/calendar:
// authenticated + present in team_members. Data is loaded with the service-role
// client (RLS would also allow team reads, but this keeps the page robust if
// session cookies aren't refreshed in a Server Component context).
export default async function TeamPosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/team/login');

  const { data: teamMember } = await supabase
    .from('team_members')
    .select('id, full_name, role, email')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!teamMember || !['team', 'admin'].includes(teamMember.role)) redirect('/team/login');

  const admin = createAdminClient();
  const [products, terminals] = await Promise.all([
    admin.from('pos_products').select('*').eq('active', true).order('sort_order').order('name'),
    admin.from('pos_terminals').select('*').eq('active', true).order('terminal_type').order('label'),
  ]);

  return (
    <RegisterClient
      products={products.data || []}
      terminals={terminals.data || []}
      cashierName={teamMember.full_name || teamMember.email}
    />
  );
}
