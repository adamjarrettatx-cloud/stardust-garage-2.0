import { notFound, redirect } from 'next/navigation';
import { requirePartner } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import GrantEntriesClient from './GrantEntriesClient';

export const revalidate = 0;

// Entry management for one allocation.
//
// The grant comes from public.partner_grants() (definer, scoped to
// partner_contact_id()) rather than a direct select, for the same reason the
// index page uses it: partners cannot read public.events, so a draft or
// internal-visibility event would otherwise render nameless. Filtering the
// result here rather than passing an id into SQL keeps the function's contract
// to "your grants" — there is no argument to get wrong.
//
// The entries themselves ARE selected directly: the Phase 1 policy
// partner_owns_grant(grant_id) already limits them to this partner's own, and a
// grantId belonging to somebody else simply matches nothing.
export default async function PartnerGrantPage({ params }) {
  const { unauthorized } = await requirePartner();
  if (unauthorized) redirect('/portal/login');

  const { grantId } = await params;
  const supabase = await createClient();

  const { data: grants, error: grantsError } = await supabase.rpc('partner_grants');
  if (grantsError) {
    console.error('[partner guest-list] partner_grants failed', grantsError);
  }

  const grant = (grants || []).find((g) => g.id === grantId);
  if (!grant) notFound();

  const { data: entries, error: entriesError } = await supabase
    .from('event_guestlist_entries')
    .select('id, guest_name, comp_type, status, created_at')
    .eq('grant_id', grantId)
    .order('created_at', { ascending: true });

  if (entriesError) {
    console.error('[partner guest-list] entries select failed', entriesError);
  }

  return <GrantEntriesClient grant={grant} initialEntries={entries || []} />;
}
