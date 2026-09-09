// GET /api/admin/membership/journey?range=7d|30d|90d|ytd|all
//
// One-shot aggregator for the Membership Journey hub at /bananas/membership.
// The hub is the single place Adam runs the human pipeline for the whole
// membership funnel — QR scan → first visit → application → approved →
// active paying member — so the API is deliberately one call that returns
// every number and every actionable row the hub needs. Pushing the joins to
// the client would double the render latency and mean six spinners on one
// screen.
//
// Shape (see JSDoc block at bottom for the full type):
//
//   summary            headline KPIs for the top strip
//   funnel             conversion between six lifecycle stages
//   stages             the "kanban" — the actual people stuck at each stage
//   trial              trial-pass rollups (sources, denials, activation)
//   members            member-side rollups (plan mix, MRR, attention list)
//   timeseries         daily new trial passes + new active members
//   next_actions       the top few things Adam should personally do today
//
// Owner-gated (`requireOwner`). Read-only. Money always in integer cents.
// Days bucketed in America/Chicago via Intl.DateTimeFormat.

import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { STRIPE_PRICES, PLAN_DISPLAY } from '@/lib/stripe-prices';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SALES_TIME_ZONE = 'America/Chicago';
const DAY_MS = 24 * 60 * 60 * 1000;

// The six lifecycle stages we track, in the order they appear in the hub.
// Every trial pass and every application/member ends up in exactly one of
// these based on the ordered rules in `resolveStage()` below.
const STAGE_ORDER = [
  'ready',        // trial pass issued, never used at the door
  'visited',      // came through the door on trial, not yet applied
  'applied',      // submitted membership_application, not yet approved
  'approved',     // application approved, Stripe subscription not yet active
  'active',       // active paying member — the finish line
  'attention',    // past-due, cancelling, or expired — needs a nudge
];

// ---------------------------------------------------------------------------
// Range parsing (identical to /api/admin/sales/summary so the two dashboards
// stay coherent when opened side-by-side)
// ---------------------------------------------------------------------------
function parseRange(rangeParam) {
  const raw = (rangeParam || '30d').toLowerCase();
  const now = new Date();
  if (raw === '7d')  return { start: new Date(now.getTime() - 7  * DAY_MS), label: '7d' };
  if (raw === '30d') return { start: new Date(now.getTime() - 30 * DAY_MS), label: '30d' };
  if (raw === '90d') return { start: new Date(now.getTime() - 90 * DAY_MS), label: '90d' };
  if (raw === 'ytd') return { start: new Date(now.getFullYear(), 0, 1), label: 'ytd' };
  return { start: new Date(0), label: 'all' };
}

// yyyy-mm-dd in Austin, used to bucket rows into daily columns for the
// timeseries. Doing this with Intl (not raw UTC math) keeps DST correct.
function austinDayKey(iso) {
  if (!iso) return null;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: SALES_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date(iso));
}

function centsToDollars(cents) {
  if (cents === null || cents === undefined) return null;
  return Math.round(cents) / 100;
}

// Given a Stripe plan slug + billing period, look up the cents-per-period from
// the price catalogue. Returns null when unknown so callers can decide whether
// to treat "unknown price" as $0 or drop the row from MRR.
function planPriceCents(plan, period) {
  const p = STRIPE_PRICES?.[plan];
  if (!p) return null;
  return p?.[period]?.cents ?? p?.monthly?.cents ?? null;
}

// Normalize a period cents to a monthly-recurring cents figure. A quarterly
// price divided by 3 and an annual price divided by 12. Keeps "MRR" a single
// comparable number regardless of the billing cadence a member is on.
function monthlyRecurringCents(plan, period) {
  const total = planPriceCents(plan, period);
  if (!total) return 0;
  const divisor = period === 'annual' ? 12 : period === 'quarterly' ? 3 : 1;
  return Math.round(total / divisor);
}

// ---------------------------------------------------------------------------
// Stage classification for a trial pass row.
// Every trial pass belongs to exactly one stage — the *most advanced* stage
// it has reached. The order below matters: it walks from finish line
// backwards, so the first match wins.
// ---------------------------------------------------------------------------
function trialPassStage(pass) {
  if (pass.converted_at) return 'active'; // handled again by member_profiles
  if (pass.applied_at)   return 'applied';
  if (pass.status === 'expired') return 'attention';
  // "visited" = at least one allowed check-in. We can't tell from just the
  // trial_passes row — the caller must pass in checkinsByPass. If activated_at
  // is populated, we already know they came through the door (the check-in
  // trigger sets that column), so it's a reliable fallback.
  if (pass.activated_at) return 'visited';
  return 'ready';
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export async function GET(request) {
  const { unauthorized } = await requireOwner();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const range = parseRange(searchParams.get('range'));
  const rangeStartIso = range.start.toISOString();

  const admin = createAdminClient();

  // One parallel fan-out. All five queries are RLS-bypassing service-role
  // reads on tables the requireOwner gate already covers.
  const [passesRes, checkinsRes, appsRes, membersRes] = await Promise.all([
    admin
      .from('trial_passes')
      .select(
        'id, full_name, email, phone, status, signup_source, source, issued_at, expires_at, extended_until, activated_at, signup_expires_at, applied_at, converted_at, phone_verified_at, member_profile_id, application_id, profile_photo_path'
      )
      .order('issued_at', { ascending: false })
      .limit(2000),
    admin
      .from('trial_pass_checkins')
      .select('trial_pass_id, result, checked_in_at, reject_reason, notes')
      .order('checked_in_at', { ascending: false })
      .limit(5000),
    admin
      .from('membership_applications')
      .select('id, plan, full_name, preferred_name, email, phone, birthday, status, created_at, account_created, photo_url, profile_photo_path')
      .order('created_at', { ascending: false })
      .limit(1000),
    admin
      .from('member_profiles')
      .select('id, full_name, email, is_active, created_at, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_plan, subscription_period, current_period_end, cancel_at_period_end, photo_url, profile_photo_path, application_id, trial_pass_code')
      .order('created_at', { ascending: false })
      .limit(2000),
  ]);

  // We surface a partial payload rather than a 500 when any single source is
  // missing — the hub still has to render, and empty sections are honest.
  const passes    = passesRes?.data    || [];
  const checkins  = checkinsRes?.data  || [];
  const apps      = appsRes?.data      || [];
  const members   = membersRes?.data   || [];

  // -----------------------------------------------------------------------
  // Derived per-pass helpers (visited? denied? check-in count?)
  // -----------------------------------------------------------------------
  const allowedCheckinsByPass = new Map();
  const firstCheckinByPass    = new Map();
  const deniedCount            = { total: 0, reasons: new Map() };

  for (const c of checkins) {
    if (c.result === 'denied') {
      deniedCount.total++;
      const reason = c.reject_reason || c.notes || 'unspecified';
      deniedCount.reasons.set(reason, (deniedCount.reasons.get(reason) || 0) + 1);
      continue;
    }
    if (c.result !== 'allowed') continue;
    const list = allowedCheckinsByPass.get(c.trial_pass_id) || [];
    list.push(c.checked_in_at);
    allowedCheckinsByPass.set(c.trial_pass_id, list);
    const prev = firstCheckinByPass.get(c.trial_pass_id);
    if (!prev || new Date(c.checked_in_at) < new Date(prev)) {
      firstCheckinByPass.set(c.trial_pass_id, c.checked_in_at);
    }
  }

  // -----------------------------------------------------------------------
  // Cross-linking: an applied trial pass points at a membership_application
  // via application_id; a converted one points at member_profile_id.
  // Build lookup maps once so the stages don't do O(n·m) scans.
  // -----------------------------------------------------------------------
  const appsById       = new Map(apps.map((a) => [a.id, a]));
  const membersById    = new Map(members.map((m) => [m.id, m]));
  const memberByAppId  = new Map(members.filter((m) => m.application_id).map((m) => [m.application_id, m]));
  const passByAppId    = new Map(passes.filter((p) => p.application_id).map((p) => [p.application_id, p]));
  const passByMemberId = new Map(passes.filter((p) => p.member_profile_id).map((p) => [p.member_profile_id, p]));

  // -----------------------------------------------------------------------
  // Build each stage's roster
  // -----------------------------------------------------------------------
  const stages = Object.fromEntries(STAGE_ORDER.map((s) => [s, []]));

  // Members first — they take precedence for anyone who reached the finish
  // line. `stripe_status_bucket` folds Stripe statuses into three ops states:
  // healthy (paying), attention (past_due, cancelling, incomplete), or dead
  // (canceled/unpaid). Dead+cancelled-at-period-end members stay under
  // Active until Stripe actually cancels them.
  const now = Date.now();
  for (const m of members) {
    if (!m.is_active) continue;
    const bucket = stripeBucket(m);
    const row = shapeMember(m, passByMemberId.get(m.id) || null);
    if (bucket === 'attention') stages.attention.push(row);
    else stages.active.push(row);
  }

  // Add expired but still-uncontacted trial passes to attention — that's the
  // "your trial just ended, want to apply?" moment.
  // Also add cancelled/past-due members that we already put in attention.

  // Applications waiting on a decision:
  for (const a of apps) {
    // Skip any application that already produced a member profile — that row
    // is already represented in Active/Attention above.
    if (memberByAppId.get(a.id)) continue;
    if (a.status === 'approved' && !a.account_created) {
      stages.approved.push(shapeApplication(a, passByAppId.get(a.id) || null));
      continue;
    }
    if (a.status === 'rejected') continue; // rejected apps are not part of the live journey
    // Everything else waiting: new, seen, contacted, pending, approved-but-account-not-created
    stages.applied.push(shapeApplication(a, passByAppId.get(a.id) || null));
  }

  // Trial passes: "visited" and "ready" columns.
  for (const p of passes) {
    // Any pass with applied_at is represented by an application row above (or
    // by a member row if converted). Any pass whose owner became a member is
    // represented by that member. Skip both to avoid a person showing up in
    // two columns at once.
    if (p.member_profile_id && membersById.has(p.member_profile_id)) continue;
    if (p.application_id && appsById.has(p.application_id)) continue;

    const stage = trialPassStage(p);
    const allowedCount = (allowedCheckinsByPass.get(p.id) || []).length;
    const firstCheckin = firstCheckinByPass.get(p.id) || null;
    const row = shapeTrialPass(p, { allowedCount, firstCheckin });

    if (stage === 'attention' && p.status === 'expired') stages.attention.push(row);
    else if (stage === 'visited' || allowedCount > 0)     stages.visited.push(row);
    else if (stage === 'ready')                            stages.ready.push(row);
  }

  // Sort each stage most-actionable first (oldest waiting at the top for
  // decision stages, newest first for reference stages).
  stages.ready     .sort((a, b) => new Date(b.issued_at)   - new Date(a.issued_at));
  stages.visited   .sort((a, b) => new Date(b.last_visit || b.issued_at) - new Date(a.last_visit || a.issued_at));
  stages.applied   .sort((a, b) => new Date(a.applied_at || a.created_at) - new Date(b.applied_at || b.created_at));
  stages.approved  .sort((a, b) => new Date(a.approved_at || a.created_at) - new Date(b.approved_at || b.created_at));
  stages.active    .sort((a, b) => new Date(b.member_since || 0) - new Date(a.member_since || 0));
  stages.attention .sort((a, b) => (attentionUrgency(b) - attentionUrgency(a)));

  // -----------------------------------------------------------------------
  // Summary / funnel numbers
  // -----------------------------------------------------------------------
  const counts = Object.fromEntries(
    STAGE_ORDER.map((s) => [s, stages[s].length])
  );

  const funnel = [
    { key: 'ready',    label: 'Trial pass issued',        count: passes.length },
    { key: 'visited',  label: 'Visited at least once',    count: [...new Set(checkins.filter((c) => c.result === 'allowed').map((c) => c.trial_pass_id))].length },
    { key: 'applied',  label: 'Submitted application',    count: passes.filter((p) => p.applied_at).length + apps.filter((a) => !passByAppId.get(a.id)).length },
    { key: 'approved', label: 'Approved to join',         count: apps.filter((a) => a.status === 'approved').length },
    { key: 'active',   label: 'Active paying member',     count: members.filter((m) => m.is_active && stripeBucket(m) === 'healthy').length },
  ];
  // Rates between adjacent funnel steps (protect against divide-by-zero).
  for (let i = 1; i < funnel.length; i++) {
    const prev = funnel[i - 1].count;
    funnel[i].rate_of_prev = prev > 0 ? funnel[i].count / prev : 0;
  }
  const endToEnd = funnel[0].count > 0 ? funnel[funnel.length - 1].count / funnel[0].count : 0;

  // -----------------------------------------------------------------------
  // Member-side: plan mix, MRR, attention list
  // -----------------------------------------------------------------------
  const planMix = {};
  let mrrCents = 0;
  for (const m of members) {
    if (!m.is_active) continue;
    if (stripeBucket(m) !== 'healthy') continue;
    const key = m.subscription_plan || 'unknown';
    const displayKey = PLAN_DISPLAY[key] || key;
    planMix[displayKey] = (planMix[displayKey] || 0) + 1;
    mrrCents += monthlyRecurringCents(m.subscription_plan, m.subscription_period);
  }

  // -----------------------------------------------------------------------
  // Trial-pass rollups (source, denial reasons, activation timing)
  // -----------------------------------------------------------------------
  const sourceMix = {};
  for (const p of passes) {
    const key = p.signup_source || 'unknown';
    sourceMix[key] = (sourceMix[key] || 0) + 1;
  }

  const activationDays = { same: 0, '1-3': 0, '4-7': 0, '8-14': 0, '15+': 0 };
  for (const p of passes) {
    const first = firstCheckinByPass.get(p.id);
    if (!first) continue;
    const days = Math.floor((new Date(first) - new Date(p.issued_at)) / DAY_MS);
    if (days <= 0) activationDays.same++;
    else if (days <= 3) activationDays['1-3']++;
    else if (days <= 7) activationDays['4-7']++;
    else if (days <= 14) activationDays['8-14']++;
    else activationDays['15+']++;
  }

  // -----------------------------------------------------------------------
  // Daily timeseries for the range: new passes, new applications, new
  // members. Empty days included so the chart has a continuous x-axis.
  // -----------------------------------------------------------------------
  const dayKeys = [];
  {
    const start = new Date(range.start);
    // Clamp start to a year ago for `all`, otherwise the chart becomes a
    // 5-year sparkline with tiny bars.
    const capped = range.label === 'all'
      ? new Date(Date.now() - 90 * DAY_MS)
      : start;
    const cursor = new Date(capped);
    const end = new Date();
    while (cursor <= end) {
      dayKeys.push(austinDayKey(cursor.toISOString()));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  const daySet = new Set(dayKeys);
  const timeseries = dayKeys.map((day) => ({ day, passes: 0, applications: 0, members: 0 }));
  const byDayIdx = new Map(timeseries.map((row, i) => [row.day, i]));

  for (const p of passes) {
    const key = austinDayKey(p.issued_at);
    if (daySet.has(key)) timeseries[byDayIdx.get(key)].passes++;
  }
  for (const a of apps) {
    const key = austinDayKey(a.created_at);
    if (daySet.has(key)) timeseries[byDayIdx.get(key)].applications++;
  }
  for (const m of members) {
    if (!m.is_active) continue;
    const key = austinDayKey(m.created_at);
    if (daySet.has(key)) timeseries[byDayIdx.get(key)].members++;
  }

  // -----------------------------------------------------------------------
  // Next actions — the top of Adam's "do this today" list.
  // Two families of action, mixed together and ranked:
  //   (a) applications waiting the longest without a decision
  //   (b) members in Stripe attention (past_due / cancelling)
  // Capped at 6 so the hub can render it as a checklist, not an inbox.
  // -----------------------------------------------------------------------
  const nextActions = [];
  for (const row of stages.applied.slice(0, 8)) {
    const ageDays = Math.max(0, Math.floor((now - new Date(row.applied_at || row.created_at)) / DAY_MS));
    nextActions.push({
      kind: 'review_application',
      urgency: 100 + ageDays,
      title: `Review ${row.full_name || 'application'}`,
      subtitle: `Waiting ${ageDays}d · ${row.plan_display || 'unknown plan'}`,
      href: `/bananas/applications/${row.id}`,
    });
  }
  for (const row of stages.attention.slice(0, 8)) {
    nextActions.push({
      kind: row.kind === 'member' ? 'member_attention' : 'trial_expired',
      urgency: attentionUrgency(row),
      title: row.kind === 'member'
        ? `Follow up with ${row.full_name} (${row.subscription_status})`
        : `Trial expired: ${row.full_name}`,
      subtitle: row.kind === 'member'
        ? (row.cancel_at_period_end ? 'Cancels at period end — offer to save' : 'Payment failed — retry or contact')
        : 'Nudge them to apply before the trial memory fades',
      href: row.kind === 'member' ? `/bananas/members/${row.id}` : `/bananas/applications`,
    });
  }
  nextActions.sort((a, b) => b.urgency - a.urgency);

  // -----------------------------------------------------------------------
  // Compose payload
  // -----------------------------------------------------------------------
  return NextResponse.json({
    generated_at: new Date().toISOString(),
    range: range.label,
    summary: {
      total_trial_passes: passes.length,
      active_members: members.filter((m) => m.is_active && stripeBucket(m) === 'healthy').length,
      attention_count: stages.attention.length,
      applications_pending: stages.applied.length,
      approved_pending_signup: stages.approved.length,
      mrr_cents: mrrCents,
      mrr_dollars: centsToDollars(mrrCents),
    },
    counts,
    funnel: {
      steps: funnel,
      end_to_end: endToEnd,
    },
    stages,
    trial: {
      source_mix: sourceMix,
      activation_days: activationDays,
      denied_total: deniedCount.total,
      denied_reasons: [...deniedCount.reasons.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    },
    members: {
      plan_mix: planMix,
    },
    timeseries,
    next_actions: nextActions.slice(0, 6),
  });
}

// ---------------------------------------------------------------------------
// Row shapers — every stage renders a card with a common shape, so the hub
// client code doesn't need to know whether the underlying record is a trial
// pass, an application, or a member.
// ---------------------------------------------------------------------------

function shapeTrialPass(p, { allowedCount, firstCheckin }) {
  const activated = Boolean(p.activated_at);
  const effectiveExpiry = activated
    ? (p.extended_until || p.expires_at)
    : p.signup_expires_at;
  const daysLeft = effectiveExpiry
    ? Math.max(0, Math.ceil((new Date(effectiveExpiry) - Date.now()) / DAY_MS))
    : null;

  return {
    kind: 'trial',
    id: p.id,
    full_name: p.full_name,
    email: p.email,
    phone: p.phone,
    photo_path: p.profile_photo_path || null,
    status: p.status,
    signup_source: p.signup_source || 'unknown',
    issued_at: p.issued_at,
    activated_at: p.activated_at || null,
    last_visit: firstCheckin,
    visits: allowedCount,
    days_left: daysLeft,
    expires_at: effectiveExpiry,
    href: null, // trial passes don't have their own admin page — the pass id is not routable yet
  };
}

function shapeApplication(a, linkedPass) {
  const displayKey = PLAN_DISPLAY[a.plan] || a.plan || 'unknown';
  return {
    kind: 'application',
    id: a.id,
    full_name: a.full_name,
    preferred_name: a.preferred_name,
    email: a.email,
    phone: a.phone,
    photo_path: a.profile_photo_path || null,
    photo_url: a.photo_url || null,
    plan: a.plan,
    plan_display: displayKey,
    status: a.status || 'new',
    created_at: a.created_at,
    applied_at: linkedPass?.applied_at || a.created_at,
    approved_at: a.status === 'approved' ? a.created_at : null, // best proxy — no explicit column
    linked_pass_id: linkedPass?.id || null,
    href: `/bananas/applications/${a.id}`,
  };
}

function shapeMember(m, linkedPass) {
  const bucket = stripeBucket(m);
  return {
    kind: 'member',
    id: m.id,
    full_name: m.full_name,
    email: m.email,
    photo_path: m.profile_photo_path || null,
    photo_url: m.photo_url || null,
    subscription_status: m.subscription_status,
    subscription_plan: m.subscription_plan,
    subscription_plan_display: PLAN_DISPLAY[m.subscription_plan] || m.subscription_plan || 'unknown',
    subscription_period: m.subscription_period,
    current_period_end: m.current_period_end,
    cancel_at_period_end: Boolean(m.cancel_at_period_end),
    member_since: m.created_at,
    monthly_cents: monthlyRecurringCents(m.subscription_plan, m.subscription_period),
    stripe_bucket: bucket,
    linked_pass_id: linkedPass?.id || null,
    href: `/bananas/members/${m.id}`,
  };
}

// Fold Stripe's rich subscription_status vocabulary into three ops states.
function stripeBucket(m) {
  const s = m.subscription_status;
  if (s === 'active' && !m.cancel_at_period_end) return 'healthy';
  if (s === 'trialing') return 'healthy';
  if (s === 'past_due' || s === 'unpaid' || s === 'incomplete') return 'attention';
  if (m.cancel_at_period_end) return 'attention';
  if (s === 'canceled' || s === 'incomplete_expired') return 'dead';
  return 'healthy';
}

function attentionUrgency(row) {
  // Higher = more urgent. Past-due members > cancelling members > expired
  // trials. Age-in-days added on so the oldest ones bubble to the top.
  const now = Date.now();
  const base =
    row.subscription_status === 'past_due' ? 300 :
    row.cancel_at_period_end               ? 200 :
    row.status === 'expired'               ? 100 :
    50;
  const anchor = row.current_period_end || row.expires_at || row.issued_at || row.created_at;
  const ageDays = anchor ? Math.floor((now - new Date(anchor)) / DAY_MS) : 0;
  return base + Math.abs(ageDays);
}
