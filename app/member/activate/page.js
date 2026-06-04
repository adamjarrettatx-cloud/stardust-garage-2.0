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

  // If already active, send back to member dashboard
  if (profile?.subscription_status === 'active') {
    redirect('/member');
  }

  // Figure out which plan they applied for from their application
  let appliedPlan = profile?.subscription_plan || null;
  if (!appliedPlan && profile?.application_id) {
    const { data: app } = await supabase
      .from('membership_applications')
      .select('plan')
      .eq('id', profile.application_id)
      .maybeSingle();

    // App plan slug might be 'cowork' or 'cowork-party' — map to our keys
    if (app?.plan === 'cowork-party') appliedPlan = 'iykyk';
    else if (app?.plan === 'cowork') appliedPlan = 'cowork';
  }

  // Fallback: let them pick the plan if we can't determine it
  return <ActivateClient initialPlan={appliedPlan} />;
}
