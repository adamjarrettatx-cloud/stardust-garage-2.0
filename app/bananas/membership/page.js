// The Membership Journey hub — one page that shows every human in the funnel
// (trial pass issued → visited → applied → approved → active paying member),
// with the number stuck at each stage, the actual people waiting, and the
// one action Adam can take to move each of them forward.
//
// Deliberately replaces the fragmented experience of jumping between
// /bananas/applications, /bananas/members, and /team/trial-pass/analytics
// with a single intuitive front door. The existing pages still work — they
// are the drill-down for each stage — so this hub is additive, not
// destructive.
//
// Owner-only. Follows the same server-page pattern as /bananas/sales:
// server component runs the gate, then hands off to a client component
// that fetches the aggregated payload from /api/admin/membership/journey.

import { redirect } from 'next/navigation';
import { ownerPageGate } from '@/lib/auth-helpers';
import MembershipHubClient from './MembershipHubClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function MembershipHubPage({ searchParams }) {
  const { redirect: gate } = await ownerPageGate();
  if (gate) redirect(gate);

  const params = await searchParams;
  const initialRange = params?.range || '30d';

  return <MembershipHubClient initialRange={initialRange} />;
}
