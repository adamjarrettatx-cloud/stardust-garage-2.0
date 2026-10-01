import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import customerContent from '@/lib/customer-content.json';
export default async function MembershipQuizResults() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('membership_quiz_results')
    .select('recommended_plans,completed_at').eq('user_id', user.id).maybeSingle();
  // Missing results should not fabricate recommendations or break the ticket wallet.
  if (!data && !error) return null;
  const labels = (data?.recommended_plans || []).map(slug => customerContent.membership.plans.find(p => p.slug === slug)?.name).filter(Boolean);
  return <section className="account-hub-panel" style={{ padding: 24, marginTop: 20 }} aria-labelledby="saved-membership-title">
    <div className="account-hub-panel-heading"><h2 id="saved-membership-title">Your membership match</h2><Link className="account-hub-text-button" href="/members?start=1">{error ? 'Try again' : 'View my results'}</Link></div>
    <p>{error ? 'Your saved quiz results could not be loaded right now.' : labels.join(' or ')}</p>
    {!error && <p style={{ color: 'var(--hub-muted)', fontSize: 14, marginTop: 8 }}>Saved to your account. View your recommendations or retake the quiz on any device.</p>}
  </section>;
}
