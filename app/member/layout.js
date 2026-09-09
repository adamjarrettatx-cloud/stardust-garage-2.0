import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';

// Server-authoritative gate for the entire /member area.
//
// SECURITY: A logged-in Supabase user is NOT automatically a member. Guest
// accounts (created by the ticketing/waiver/trial-pass flows) are real
// auth.users rows with no member_profiles row. Prior to this gate, those
// guests could land on /member and see the "Activate Membership" CTA even
// though only admin-approved applicants should ever reach this area (see
// app/api/admin/approve-member/route.js — the only writer of member_profiles).
//
// The Stripe checkout API already refuses to charge users without a profile,
// so no one was billed, but the UX exposed member-only surfaces to guests.
// This gate closes that hole in one place for every /member/* route.
export default async function MemberLayout({ children }) {
  const { user } = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('member_profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();

  // No profile = not an approved member. Send them to the public site.
  if (!profile) {
    redirect('/');
  }

  return <>{children}</>;
}
