import { redirect } from 'next/navigation';
import { ownerPageGate } from '@/lib/auth-helpers';
import SalesClient from './SalesClient';

// Owner-only Sales dashboard — the single home for the new first-party
// payment flow (internal ticket orders, memberships, refunds/comps, and the
// live Stripe balance/payouts).
//
// This page is separate from /bananas/financials on purpose: Financials is
// the historical income-accounting surface (TicketTailor + POS + manual
// income, bucketed by event date). Sales is about what Stripe is doing for
// us RIGHT NOW: money moving in, money going back out, cards on file, next
// payout to the bank. Under MONEY in the admin sidebar.
//
// Access gate mirrors every other owner-only admin page: ownerPageGate() runs
// server-side and bounces non-owners to /bananas. The API route this page
// calls (/api/admin/sales/summary) reruns the same gate — the nav link is
// NOT the security boundary.
export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function SalesPage({ searchParams }) {
  const { redirect: gate } = await ownerPageGate();
  if (gate) redirect(gate);

  const params = await searchParams;
  const initialRange = params?.range || '30d';

  return <SalesClient initialRange={initialRange} />;
}
