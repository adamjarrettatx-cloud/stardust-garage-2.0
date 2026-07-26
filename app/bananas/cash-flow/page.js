import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { ownerPageGate } from '@/lib/auth-helpers';
import { monthsAgoStart, normalizeTransaction } from '@/lib/financial-ledger';
import CashFlowClient from './CashFlowClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// How much history the dashboard loads up front. The trend view shows 12
// months, and the date-range picker is clamped to the same window client-side,
// so there is nothing to gain from reading the whole ledger.
const TREND_MONTHS = 12;

// Owner-only Financial Cash Flow dashboard (MVP phase 1: TicketTailor + SpotOn).
// Access is gated server-side by ownerPageGate(), identical to Event Analytics
// and the Financial Calendar — the nav tile is NOT the security boundary.
export default async function CashFlowPage() {
  const { redirect: gate } = await ownerPageGate();
  if (gate) redirect(gate);

  // Gated above; this server component is never bundled to the browser, so we
  // read with the service-role client rather than depending on RLS to confine
  // rows (same pattern as /bananas/analytics and /bananas/financial-calendar).
  const supabase = createAdminClient();

  const windowStart = monthsAgoStart(TREND_MONTHS, new Date());

  // Every table here is new in 20260726_financial_ledger.sql. An environment
  // that has not applied the migration yet degrades to an empty dashboard with
  // a setup notice rather than a 500.
  const accountsRes = await supabase
    .from('financial_accounts')
    .select('id, name, account_type, is_active')
    .order('name', { ascending: true });

  const txnRes = await supabase
    .from('financial_transactions')
    .select('id, account_id, transaction_date, amount, direction, txn_type, category, source, external_ref, linked_event_id, import_batch_id, notes, created_at')
    .gte('transaction_date', windowStart)
    .order('transaction_date', { ascending: false })
    .limit(5000);

  const batchesRes = await supabase
    .from('spoton_import_batches')
    .select('id, filename, status, row_count, created_at, confirmed_at')
    .eq('status', 'confirmed')
    .order('created_at', { ascending: false })
    .limit(200);

  const migrationApplied = !accountsRes.error;
  const accounts = accountsRes.data || [];
  const transactions = (txnRes.data || []).map(normalizeTransaction);
  const batches = batchesRes.data || [];

  // Titles for the TicketTailor rows' "back to source" links. Only the events
  // actually referenced by a ledger row are fetched.
  const eventIds = [...new Set(transactions.map((t) => t.linkedEventId).filter(Boolean))];
  let eventTitles = {};
  if (eventIds.length) {
    const { data: events } = await supabase
      .from('events')
      .select('id, title')
      .in('id', eventIds);
    eventTitles = Object.fromEntries((events || []).map((e) => [e.id, e.title]));
  }

  return (
    <CashFlowClient
      accounts={accounts}
      transactions={transactions}
      batches={batches}
      eventTitles={eventTitles}
      todayIso={new Date().toISOString()}
      trendMonths={TREND_MONTHS}
      migrationApplied={migrationApplied}
    />
  );
}
