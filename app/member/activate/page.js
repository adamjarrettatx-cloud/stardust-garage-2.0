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

    if (app?.plan === 'cowork-party') appliedPlan = 'iykyk';
    else if (app?.plan === 'cowork') appliedPlan = 'cowork';
  }

  return <ActivateClient initialPlan={appliedPlan} />;
}
