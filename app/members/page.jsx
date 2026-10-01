import React from 'react';
import customerContent from '@/lib/customer-content.json';
import MembershipQuiz from './MembershipQuiz';
import MembershipWelcome from './MembershipWelcome';
import { createClient } from '@/lib/supabase/server';
import ApplicationAccountGate from './apply/[plan]/ApplicationAccountGate';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Find your membership | Stardust Garage',
  description: 'Find the Stardust Garage membership that fits your workdays, weekend nights, and community.',
};
export default async function MembersPage({ searchParams }) {
  const params = await searchParams;
  // Introduce discovery before authentication or the first question.
  // An explicit start URL also lets the account profile reopen saved results.
  if (params?.start !== '1') return <MembershipWelcome />;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <ApplicationAccountGate quiz />;
  const { data, error } = await supabase.from('membership_quiz_results')
    .select('answers,selected_plan').eq('user_id', user.id).maybeSingle();
  if (error) return <main className="max-w-[568px] mx-auto px-6 py-16"><h1 className="text-2xl mb-4">Your membership quiz</h1><p>Your saved results could not be loaded. Please try again shortly.</p><a className="inline-block underline mt-6" href="/members?start=1">Try again</a></main>;
  return <MembershipQuiz plans={customerContent.membership.plans} savedQuiz={data} />;
}
