import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireOwner } from '@/lib/auth-helpers';
import { stripe } from '@/lib/stripe/client';

// GET /api/admin/sales/summary?range=30d
//
// Owner-only unified sales roll-up powering /bananas/sales. Reads every money
// surface the internal payment flow touches:
//
//   1. Internal ticket ORDERS (public.orders): gross, refunded, comps, net,
//      tax collected, tax refunded, order counts by status.
//   2. Memberships (public.member_profiles): active count, MRR estimate,
//      trial / past_due / cancelling status breakdown, new signups in range.
//   3. Refunds + comps (from orders + ticket_audit_log): rows for the table.
//   4. Stripe balance + upcoming payouts + payout history (live Stripe API).
//
// Every dollar value is returned in integer cents. Timezone-sensitive daily
// buckets are computed in America/Chicago because the Financial Overview,
// Financial Calendar, and Time-Series helpers all agree on that convention.
//
// Range: 7d | 30d | 90d | ytd | all. Anything else falls back to 30d.
// Everything is safe to render partial — if the Stripe API call errors, we
// still return the DB numbers so the page never blanks out.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VENUE_TZ = 'America/Chicago';

function rangeStart(range, now) {
  const d = new Date(now);
  switch (range) {
    case '7d':  d.setUTCDate(d.getUTCDate() - 7); return d;
    case '90d': d.setUTCDate(d.getUTCDate() - 90); return d;
    case 'ytd': {
      // Jan 1 in venue-local time, expressed as UTC. Cheap approximation:
      // Chicago is UTC-6 (CST) / UTC-5 (CDT). We land on the correct calendar
      // day either way because the bucketing uses formatToParts below.
      const localYear = new Intl.DateTimeFormat('en-US', {
        timeZone: VENUE_TZ, year: 'numeric',
      }).format(now);
      return new Date(`${localYear}-01-01T06:00:00Z`);
    }
    case 'all': return new Date('2020-01-01T00:00:00Z');
    case '30d':
    default:    d.setUTCDate(d.getUTCDate() - 30); return d;
  }
}

// Venue-local YYYY-MM-DD for a Date. Used for daily bucketing so a 10pm CT
// sale on Friday lands in Friday's bar, not Saturday's.
function localDayKey(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: VENUE_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(date));
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const d = parts.find((p) => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

// Emit every venue-local day from start..end inclusive so the daily chart
// has a bar for zero-sale days instead of collapsing them.
function daysBetween(startDate, endDate) {
  const out = [];
  const cursor = new Date(startDate);
  cursor.setUTCHours(12, 0, 0, 0); // avoid DST edge fencing
  const stop = new Date(endDate);
  stop.setUTCHours(12, 0, 0, 0);
  while (cursor <= stop) {
    out.push(localDayKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

// Roughly convert a subscription plan into cents/month for MRR. Falls back
// to zero when we can't infer, so unknown plans don't pollute the total.
// Membership pricing lives on the Stripe side; this mirrors what the
// existing subscription flow charges so we don't have to round-trip to
// Stripe for every profile. Update alongside lib/stripe-prices.js.
const PLAN_MONTHLY_CENTS = {
  founding_monthly: 12500,     // $125/mo Founding Member (illustrative)
  founding_annual: 10416,      // $1,250/yr / 12 (illustrative)
  standard_monthly: 7500,
  standard_annual: 6250,
  trial: 0,
};
function planMonthlyCents(plan, period) {
  if (!plan) return 0;
  const key = `${plan}_${period || 'monthly'}`.toLowerCase();
  return PLAN_MONTHLY_CENTS[key] ?? PLAN_MONTHLY_CENTS[`${plan}_monthly`.toLowerCase()] ?? 0;
}

export async function GET(request) {
  const gate = await requireOwner();
  if (gate.unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const range = url.searchParams.get('range') || '30d';
  const now = new Date();
  const startIso = rangeStart(range, now).toISOString();

  const supabase = createAdminClient();

  // ---- Orders in range --------------------------------------------------
  // We pull every order in the window (not just paid) so status counts and
  // failed-order rates are honest. Money math only counts paid-like rows.
  const ordersRes = await supabase
    .from('orders')
    .select(`
      id, event_id, buyer_email, buyer_name, status,
      subtotal_cents, fees_cents, total_cents, refunded_cents,
      tax_cents, refunded_tax_cents,
      discount_cents, booking_fee_unit_cents,
      checkout_kind, comp_ref, created_by_user_id,
      stripe_payment_intent_id, paid_at, refunded_at, created_at,
      events:events(id, title, event_date)
    `)
    .gte('created_at', startIso)
    .order('created_at', { ascending: false })
    .limit(2000);

  const orders = ordersRes.data || [];

  // Also grab the paid-in-range set explicitly by paid_at, since a pending
  // order created three days ago and paid today should count today.
  const paidInRangeRes = await supabase
    .from('orders')
    .select('id, total_cents, tax_cents, refunded_cents, refunded_tax_cents, status, paid_at, checkout_kind')
    .gte('paid_at', startIso)
    .in('status', ['paid', 'refunded', 'partial_refund'])
    .limit(2000);
  const paidInRange = paidInRangeRes.data || [];

  // ---- KPI math ---------------------------------------------------------
  const paidLike = paidInRange;
  const grossCents      = paidLike.reduce((s, o) => s + (o.total_cents || 0), 0);
  const refundedCents   = paidLike.reduce((s, o) => s + (o.refunded_cents || 0), 0);
  const netCents        = grossCents - refundedCents;
  const taxCollected    = paidLike.reduce((s, o) => s + (o.tax_cents || 0), 0);
  const taxRefunded     = paidLike.reduce((s, o) => s + (o.refunded_tax_cents || 0), 0);
  const netTaxOwed      = taxCollected - taxRefunded;
  const compCount       = paidLike.filter((o) => o.checkout_kind === 'comp').length;
  const paidOrderCount  = paidLike.filter((o) => o.status !== 'refunded').length;
  const refundedOrderCount = paidLike.filter((o) => o.status === 'refunded').length;

  const orderStatusCounts = orders.reduce((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1;
    return acc;
  }, {});

  // Average order value on genuinely paid, non-comp orders — comps distort
  // AOV because they're always $0 by definition.
  const paidNonComp = paidLike.filter((o) => o.checkout_kind !== 'comp' && (o.total_cents || 0) > 0);
  const aovCents = paidNonComp.length
    ? Math.round(paidNonComp.reduce((s, o) => s + o.total_cents, 0) / paidNonComp.length)
    : 0;

  // ---- Daily time series ------------------------------------------------
  // Two lines: gross paid (bars) and refunds (overlay). Empty days stay in.
  const dayBuckets = new Map(daysBetween(startIso, now).map((d) => [d, { day: d, gross: 0, refunds: 0, orders: 0 }]));
  for (const o of paidLike) {
    if (!o.paid_at) continue;
    const key = localDayKey(o.paid_at);
    const bucket = dayBuckets.get(key);
    if (!bucket) continue;
    bucket.gross += (o.total_cents || 0);
    bucket.orders += 1;
  }
  // Refund day = refunded_at, not paid_at — that's when the money moved.
  const refundedInRange = paidLike.filter((o) => o.refunded_at && (o.refunded_cents || 0) > 0);
  for (const o of refundedInRange) {
    const key = localDayKey(o.refunded_at);
    const bucket = dayBuckets.get(key);
    if (!bucket) continue;
    bucket.refunds += (o.refunded_cents || 0);
  }
  const timeseries = [...dayBuckets.values()];

  // ---- Revenue by event (top N) ----------------------------------------
  const eventRollup = new Map();
  for (const o of paidLike) {
    // paidInRange doesn't join events; look it up from the fuller orders list
    // where available, otherwise stash under 'unknown'.
    const full = orders.find((x) => x.id === o.id);
    const eventId = full?.event_id || 'unknown';
    const title = full?.events?.title || 'Untitled event';
    const eventDate = full?.events?.event_date || null;
    const row = eventRollup.get(eventId) || {
      event_id: eventId, title, event_date: eventDate,
      gross: 0, refunds: 0, orders: 0, comps: 0,
    };
    row.gross += (o.total_cents || 0);
    row.refunds += (o.refunded_cents || 0);
    row.orders += 1;
    if (o.checkout_kind === 'comp') row.comps += 1;
    eventRollup.set(eventId, row);
  }
  const revenueByEvent = [...eventRollup.values()]
    .sort((a, b) => (b.gross - b.refunds) - (a.gross - a.refunds))
    .slice(0, 10);

  // ---- Recent orders (for the orders tab) ------------------------------
  const recentOrders = orders.slice(0, 100).map((o) => ({
    id: o.id,
    created_at: o.created_at,
    paid_at: o.paid_at,
    buyer_email: o.buyer_email,
    buyer_name: o.buyer_name,
    status: o.status,
    checkout_kind: o.checkout_kind || 'purchase',
    total_cents: o.total_cents,
    refunded_cents: o.refunded_cents,
    tax_cents: o.tax_cents,
    event_id: o.event_id,
    event_title: o.events?.title || null,
    stripe_payment_intent_id: o.stripe_payment_intent_id,
  }));

  // ---- Refunds + comps log ---------------------------------------------
  // Refunds come straight off the orders table (any refunded_cents > 0 or
  // status in refunded/partial_refund). Comps come from checkout_kind='comp'.
  const refundRows = orders
    .filter((o) => (o.refunded_cents || 0) > 0 || o.status === 'refunded' || o.status === 'partial_refund')
    .slice(0, 100)
    .map((o) => ({
      id: o.id,
      refunded_at: o.refunded_at,
      buyer_email: o.buyer_email,
      event_title: o.events?.title || null,
      original_total_cents: o.total_cents,
      refunded_cents: o.refunded_cents,
      refunded_tax_cents: o.refunded_tax_cents,
      is_full: o.status === 'refunded',
    }));

  const compRows = orders
    .filter((o) => o.checkout_kind === 'comp')
    .slice(0, 100)
    .map((o) => ({
      id: o.id,
      created_at: o.created_at,
      buyer_email: o.buyer_email,
      buyer_name: o.buyer_name,
      event_title: o.events?.title || null,
      created_by_user_id: o.created_by_user_id,
      comp_ref: o.comp_ref,
    }));

  // ---- Memberships / subscriptions -------------------------------------
  const membersRes = await supabase
    .from('member_profiles')
    .select('id, email, full_name, is_active, subscription_status, subscription_plan, subscription_period, current_period_end, cancel_at_period_end, stripe_subscription_id, created_at')
    .limit(2000);
  const members = membersRes.data || [];

  const activeMembers = members.filter((m) => m.is_active && m.subscription_status === 'active');
  const trialingMembers = members.filter((m) => m.subscription_status === 'trialing');
  const pastDueMembers = members.filter((m) => m.subscription_status === 'past_due');
  const cancellingMembers = members.filter((m) => m.cancel_at_period_end);
  const newMembersInRange = members.filter((m) => m.created_at && new Date(m.created_at) >= new Date(startIso));

  const mrrCents = activeMembers.reduce(
    (s, m) => s + planMonthlyCents(m.subscription_plan, m.subscription_period),
    0
  );

  const planBreakdown = activeMembers.reduce((acc, m) => {
    const key = `${m.subscription_plan || 'unknown'}·${m.subscription_period || 'monthly'}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  // ---- Stripe balance + payouts (live) ---------------------------------
  // These are cheap Stripe calls (single page each). If any errors, we
  // return null for that block rather than 500ing the whole page — the DB
  // half is the important part.
  let stripeBlock = { available: null, pending: null, upcoming_payout: null, recent_payouts: [], error: null };
  try {
    const [balance, payoutList] = await Promise.all([
      stripe.get('/balance'),
      stripe.get('/payouts', { query: { limit: 10 } }),
    ]);

    const usd = (arr) => (arr || []).filter((b) => b.currency === 'usd').reduce((s, b) => s + b.amount, 0);
    stripeBlock.available = usd(balance.available);
    stripeBlock.pending = usd(balance.pending);
    stripeBlock.recent_payouts = (payoutList.data || []).map((p) => ({
      id: p.id,
      amount_cents: p.amount,
      currency: p.currency,
      status: p.status,
      arrival_date: p.arrival_date ? new Date(p.arrival_date * 1000).toISOString() : null,
      method: p.method,
      description: p.description,
    }));
    // The next scheduled payout is the topmost 'pending' or 'in_transit' one.
    stripeBlock.upcoming_payout = stripeBlock.recent_payouts.find(
      (p) => p.status === 'pending' || p.status === 'in_transit',
    ) || null;
  } catch (err) {
    stripeBlock.error = err?.message || 'Stripe balance unavailable';
  }

  return NextResponse.json({
    range,
    generated_at: now.toISOString(),
    range_start: startIso,
    currency: 'usd',
    money: {
      gross_cents: grossCents,
      refunded_cents: refundedCents,
      net_cents: netCents,
      tax_collected_cents: taxCollected,
      tax_refunded_cents: taxRefunded,
      net_tax_owed_cents: netTaxOwed,
      aov_cents: aovCents,
    },
    counts: {
      paid_orders: paidOrderCount,
      refunded_orders: refundedOrderCount,
      comps: compCount,
      order_status: orderStatusCounts,
    },
    memberships: {
      active_count: activeMembers.length,
      trialing_count: trialingMembers.length,
      past_due_count: pastDueMembers.length,
      cancelling_count: cancellingMembers.length,
      new_in_range_count: newMembersInRange.length,
      mrr_cents: mrrCents,
      plan_breakdown: planBreakdown,
      // Only surface the "action needed" rows in the table; the full roster
      // is a click away in /bananas/members.
      attention: [...pastDueMembers, ...cancellingMembers.filter((m) => !pastDueMembers.includes(m))]
        .slice(0, 30)
        .map((m) => ({
          id: m.id,
          email: m.email,
          full_name: m.full_name,
          subscription_status: m.subscription_status,
          subscription_plan: m.subscription_plan,
          current_period_end: m.current_period_end,
          cancel_at_period_end: m.cancel_at_period_end,
        })),
    },
    stripe: stripeBlock,
    timeseries,
    revenue_by_event: revenueByEvent,
    recent_orders: recentOrders,
    refunds: refundRows,
    comps: compRows,
  });
}
