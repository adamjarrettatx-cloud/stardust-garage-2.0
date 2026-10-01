import { notFound } from 'next/navigation';
import ApplyForm from './ApplyForm';
import customerContent from '@/lib/customer-content.json';
import { createClient } from '@/lib/supabase/server';
import ApplicationAccountGate from './ApplicationAccountGate';

export default async function ApplyPage({ params }) {
  const { plan } = await params;
  const planInfo = customerContent.membership.plans.find(item => item.slug === plan);

  if (!planInfo) {
    notFound();
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <ApplicationAccountGate planName={planInfo.name} />;
  const { data: saved } = await supabase.from('membership_quiz_results').select('answers').eq('user_id', user.id).maybeSingle();
  const quiz = saved?.answers || null;
  return <ApplyForm planSlug={plan} planName={planInfo.name} planPrice={`${planInfo.price}/mo`}
    accountEmail={user.email || ''} accountName={user.user_metadata?.full_name || ''} quiz={quiz} />;
}
