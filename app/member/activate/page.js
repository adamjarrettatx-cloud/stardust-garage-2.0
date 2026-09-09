import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import ActivateClient from './ActivateClient';

export const revalidate = 0;

export default async function ActivatePage() {
  const { user } = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('member_profiles')
    .select('subscription_plan, subscription_status, application_id')
    .eq('user_id', user.id)
    .maybeSingle();

  // Belt-and-suspenders: MemberLayout already blocks guests without a
  // member_profiles row, but this page must never render a plan picker or
  // "Continue to Payment" flow for a non-member. If the layout gate is ever
  // bypassed or this route is reached directly, refuse here too.
  if (!profile) {
    redirect('/');
  }

  if (profile?.subscription_status === 'active') {
    redirect('/member');
  }

  let appliedPlan = profile?.subscription_plan || null;
  if (!appliedPlan && profile?.application_id) {
    const { data: app } = await supabase
      .from('membership_applications')
      .select('plan')
      .eq('id', profile.application_id)
      .maybeSingle();

    // Map application slugs → internal STRIPE_PRICES keys. 'cowork-party' is
    // the legacy slug that predates the marketing rename → 'iykyk' internally.
    if (app?.plan === 'cowork-party') appliedPlan = 'iykyk';
    else if (app?.plan === 'cowork') appliedPlan = 'cowork';
    else if (app?.plan === 'weekender') appliedPlan = 'weekender';
  }

  return <ActivateClient initialPlan={appliedPlan} />;
}
