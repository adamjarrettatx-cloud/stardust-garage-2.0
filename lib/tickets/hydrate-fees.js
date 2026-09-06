// Backfill Stripe processor fees onto orders.fees_cents.
//
// Why: `finalizeTicketOrder` in lib/tickets/fulfillment.js writes fees_cents=0
// at webhook time, because the fee amount lives on the BalanceTransaction and
// isn't populated until Stripe finalizes the transaction (usually within a few
// seconds, sometimes longer). A nightly sweep reads the balance_transaction on
// each still-un-hydrated order and writes the fee back, so the admin summary
// and downstream financial-ledger show accurate net revenue.
//
// Safe & idempotent:
//   - Only picks orders where checkout_kind='ticket_order', status IN ('paid',
//     'partial_refund','refunded'), fees_cents=0, paid_at older than a small
//     grace window and newer than 60 days (backfill horizon).
//   - Never overwrites a non-zero fees_cents.
//   - Batches to `limit` per run so long back-catalogs don't blow the cron
//     budget; the next run picks up the rest.
//   - Zero writes on rows Stripe hasn't finalized yet (charge lacks a
//     balance_transaction id) — we just skip and retry next run.
//
// Amount semantics:
//   - `balance_transaction.fee` is the total processor fee for that charge in
//     the presentment currency. That is what we want. `fee_details` contains
//     the breakdown (stripe_fee, tax, application_fee) — not needed here.

import { stripe as defaultStripe } from '../stripe/client.js';

const GRACE_MINUTES = 30; // wait a bit before hydrating so Stripe has time to finalize
const HORIZON_DAYS = 60;  // don't try to backfill orders older than this

// The exact set of order statuses eligible for hydration. Refunded orders still
// carry a processor fee (Stripe keeps the fee on refunds), so those must be
// hydrated too.
const ELIGIBLE_STATUSES = ['paid', 'partial_refund', 'refunded'];

export async function fetchChargeFee(stripeClient, chargeId) {
  const charge = await stripeClient.get(`/charges/${chargeId}`);
  const balanceTxnId = charge?.balance_transaction;
  if (!balanceTxnId) {
    return { fee_cents: null, reason: 'no_balance_transaction' };
  }
  const bt = await stripeClient.get(`/balance_transactions/${balanceTxnId}`);
  const fee = Number(bt?.fee);
  if (!Number.isFinite(fee)) {
    return { fee_cents: null, reason: 'no_fee' };
  }
  return { fee_cents: fee, reason: 'ok' };
}

// Run hydration. `supabaseAdmin` is a service-role client. `stripeClient` is
// injectable for tests; defaults to the shared HTTP client. Returns a summary.
export async function hydrateTicketOrderFees(supabaseAdmin, { limit = 200, stripeClient = defaultStripe } = {}) {
  const now = new Date();
  const cutoffOld = new Date(now.getTime() - HORIZON_DAYS * 24 * 3600 * 1000).toISOString();
  const cutoffNew = new Date(now.getTime() - GRACE_MINUTES * 60 * 1000).toISOString();

  const { data: rows, error } = await supabaseAdmin
    .from('orders')
    .select('id, stripe_charge_id, stripe_payment_intent_id, fees_cents, paid_at, currency')
    .eq('checkout_kind', 'ticket_order')
    .in('status', ELIGIBLE_STATUSES)
    .eq('fees_cents', 0)
    .not('stripe_charge_id', 'is', null)
    .gte('paid_at', cutoffOld)
    .lte('paid_at', cutoffNew)
    .order('paid_at', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Fetch orders failed: ${error.message}`);

  const summary = {
    scanned: rows?.length || 0,
    hydrated: 0,
    skipped_no_bt: 0,
    skipped_no_fee: 0,
    errors: 0,
    error_details: [],
  };

  for (const row of rows || []) {
    try {
      const { fee_cents, reason } = await fetchChargeFee(stripeClient, row.stripe_charge_id);
      if (reason === 'no_balance_transaction') {
        summary.skipped_no_bt += 1;
        continue;
      }
      if (reason === 'no_fee') {
        summary.skipped_no_fee += 1;
        continue;
      }
      // Idempotency guard: never overwrite a nonzero value.
      const upd = await supabaseAdmin
        .from('orders')
        .update({ fees_cents: fee_cents })
        .eq('id', row.id)
        .eq('fees_cents', 0);
      if (upd.error) throw new Error(upd.error.message);
      summary.hydrated += 1;
    } catch (e) {
      summary.errors += 1;
      if (summary.error_details.length < 10) {
        summary.error_details.push({ order_id: row.id, message: String(e.message || e) });
      }
    }
  }

  return summary;
}
