// GET /api/admin/membership/journey
//
// Backs the tabbed Membership hub at /bananas/membership. Six tabs, each a
// flat list of the accounts currently in that state:
//
//   guest             — free_accounts row exists, no trial pass issued yet
//   trial_ready       — trial pass issued, never used at the door
//   trial_activated   — activated (came through the door) OR extended, still trialling
//   weekender         — active paying member on the Weekender plan
//   builder           — active paying member on the Builder (cowork) plan
//   insider           — active paying member on the Insider (iykyk) plan
//
// Deliberately narrower than the old kanban: no funnel chart, no timeseries,
// no attention column. Applications, approvals, past-due, and cancelling
// members live in the existing /bananas/applications and /bananas/members
// surfaces; this hub is purely about "who is at each state right now".
//
// Owner-gated (`requireOwner`). Read-only. Money in integer cents.

import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { STRIPE_PRICES, PLAN_DISPLAY } from '@/lib/stripe-prices';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DAY_MS = 24 * 60 * 60 * 1000;

// The six tabs in journey order. Order here is order rendered.
const TAB_ORDER = [
  'guest',
  'trial_ready',
  'trial_activated',
  'weekender',
  'builder',
  'insider',
];

// Plan slug → tab id. Any active member on a plan not in this map is
// invisible in the tabbed view (there is intentionally no "other" bucket —
// the ops surface for that is /bananas/members).
const PLAN_TO_TAB = {
  weekender:      'weekender',
  cowork:         'builder',
  'cowork-party': 'builder',
  iykyk:          'insider',
};

// Display metadata for each tab. `hint` is a short subtitle rendered under
// the tab label when it's selected, so Adam always knows what defines the
// current filter.
export const TAB_META = {
  guest:           { label: 'Guest',            hint: 'Account created, no trial pass yet',        accent: '#d4d4d8' },
  trial_ready:     { label: 'Trial Ready',      hint: 'Trial pass issued, never used at the door', accent: '#ffb84d' },
  trial_activated: { label: 'Trial Activated',  hint: 'Came through the door on trial',            accent: '#facc15' },
  weekender:       { label: 'The Weekender',    hint: 'Active paying member — Weekender plan',     accent: '#a78bfa' },
  builder:         { label: 'The Builder',      hint: 'Active paying member — Builder plan',       accent: '#c084fc' },
  insider:         { label: 'The Insider',      hint: 'Active paying member — Insider plan',       accent: '#4ade80' },
};

function planPriceCents(plan, period) {
  const p = STRIPE_PRICES?.[plan];
  if (!p) return null;
  return p?.[period]?.cents ?? p?.monthly?.cents ?? null;
}

// Normalise any billing cadence to monthly cents so MRR-per-tab is
// comparable across mixed monthly/quarterly/annual members.
function monthlyRecurringCents(plan, period) {
  const total = planPriceCents(plan, period);
  if (!total) return 0;
  const divisor = period === 'annual' ? 12 : period === 'quarterly' ? 3 : 1;
  return Math.round(total / divisor);
}

// A member is considered a "paying, healthy" member when Stripe still bills
// them AND they haven't scheduled a cancellation. Trialling on Stripe still
// counts (trial is a paid-plan state). Past-due / cancelling / cancelled
// are excluded — those are the responsibility of /bananas/members, not this
// tabbed hub.
function isPayingHealthy(m) {
  if (!m.is_active) return false;
  if (m.cancel_at_period_end) return false;
  const s = m.subscription_status;
  return s === 'active' || s === 'trialing';
}

export async function GET() {
  const { unauthorized } = await requireOwner();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  // Parallel fan-out over the four sources we cross-link.
  const [passesRes, checkinsRes, membersRes, accountsRes] = await Promise.all([
    admin
      .from('trial_passes')
      .select(
        'id, full_name, email, phone, status, signup_source, issued_at, expires_at, extended_until, activated_at, signup_expires_at, applied_at, converted_at, member_profile_id, application_id, profile_photo_path, user_id'
      )
      .order('issued_at', { ascending: false })
      .limit(2000),
    admin
      .from('trial_pass_checkins')
      .select('trial_pass_id, result, checked_in_at')
      .eq('result', 'allowed')
      .order('checked_in_at', { ascending: false })
      .limit(5000),
    admin
      .from('member_profiles')
      .select(
        'id, full_name, email, is_active, created_at, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_plan, subscription_period, current_period_end, cancel_at_period_end, photo_url, profile_photo_path, application_id, user_id'
      )
      .order('created_at', { ascending: false })
      .limit(2000),
    admin
      .from('free_accounts')
      .select('id, user_id, full_name, email, phone, phone_verified_at, created_at, profile_photo_path')
      .order('created_at', { ascending: false })
      .limit(2000),
  ]);

  const passes    = passesRes?.data    || [];
  const checkins  = checkinsRes?.data  || [];
  const members   = membersRes?.data   || [];
  const accounts  = accountsRes?.data  || [];

  // Per-pass check-in counts + first visit. Used both to detect activation
  // and to render a "visited N× · last …" line on trial cards.
  const allowedByPass = new Map();
  const firstCheckinByPass = new Map();
  for (const c of checkins) {
    const list = allowedByPass.get(c.trial_pass_id) || [];
    list.push(c.checked_in_at);
    allowedByPass.set(c.trial_pass_id, list);
    const prev = firstCheckinByPass.get(c.trial_pass_id);
    if (!prev || new Date(c.checked_in_at) < new Date(prev)) {
      firstCheckinByPass.set(c.trial_pass_id, c.checked_in_at);
    }
  }

  // A user_id represented by any pass or paying-member row is NOT a guest —
  // suppress them from the Guest tab so we don't double-count. Do this only
  // by user_id; email/phone matching is unreliable.
  const advancedUserIds = new Set();
  for (const p of passes) if (p.user_id) advancedUserIds.add(p.user_id);
  for (const m of members) if (m.user_id) advancedUserIds.add(m.user_id);

  // A trial pass whose owner already became a paying member is NOT a trial
  // row — suppress it from the trial tabs.
  const memberUserIds = new Set(members.filter((m) => m.user_id).map((m) => m.user_id));

  // -----------------------------------------------------------------------
  // Build each tab's list
  // -----------------------------------------------------------------------
  const tabs = Object.fromEntries(TAB_ORDER.map((t) => [t, []]));

  // Guest — free_account with no advancement yet.
  for (const acc of accounts) {
    if (advancedUserIds.has(acc.user_id)) continue;
    tabs.guest.push(shapeAccount(acc));
  }

  // Trial ready / activated — trial passes whose owner is not yet a paying
  // member, split by whether they've come through the door.
  for (const p of passes) {
    if (p.user_id && memberUserIds.has(p.user_id)) continue;
    // A pass that already produced a conversion is represented elsewhere.
    if (p.converted_at) continue;

    const allowedCount = (allowedByPass.get(p.id) || []).length;
    const firstCheckin = firstCheckinByPass.get(p.id) || null;
    const activated = Boolean(p.activated_at) || allowedCount > 0;

    const row = shapeTrialPass(p, { allowedCount, firstCheckin });
    if (activated) tabs.trial_activated.push(row);
    else tabs.trial_ready.push(row);
  }

  // Paying-healthy members bucketed by plan → tab.
  for (const m of members) {
    if (!isPayingHealthy(m)) continue;
    const tab = PLAN_TO_TAB[m.subscription_plan];
    if (!tab) continue;
    tabs[tab].push(shapeMember(m));
  }

  // Sort each tab most-recently-relevant first.
  tabs.guest           .sort((a, b) => new Date(b.created_at)   - new Date(a.created_at));
  tabs.trial_ready     .sort((a, b) => new Date(b.issued_at)    - new Date(a.issued_at));
  tabs.trial_activated .sort((a, b) => new Date(b.last_visit || b.activated_at || b.issued_at)
                                     - new Date(a.last_visit || a.activated_at || a.issued_at));
  for (const t of ['weekender', 'builder', 'insider']) {
    tabs[t].sort((a, b) => new Date(b.member_since) - new Date(a.member_since));
  }

  const counts   = Object.fromEntries(TAB_ORDER.map((t) => [t, tabs[t].length]));
  const mrrCents = Object.fromEntries(
    ['weekender', 'builder', 'insider'].map((t) => [
      t,
      tabs[t].reduce((sum, r) => sum + (r.monthly_cents || 0), 0),
    ])
  );

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    tab_order: TAB_ORDER,
    tab_meta: TAB_META,
    counts,
    mrr_cents: mrrCents,
    tabs,
  });
}

// ---------------------------------------------------------------------------
// Row shapers — every tab renders a uniform profile card, so the client
// doesn't branch on kind for layout, only for the small pieces of context
// text below the name.
// ---------------------------------------------------------------------------

function shapeAccount(acc) {
  const ageDays = Math.max(0, Math.floor((Date.now() - new Date(acc.created_at)) / DAY_MS));
  return {
    kind: 'account',
    id: acc.id,
    user_id: acc.user_id,
    full_name: acc.full_name,
    email: acc.email,
    phone: acc.phone,
    photo_path: acc.profile_photo_path || null,
    phone_verified: Boolean(acc.phone_verified_at),
    created_at: acc.created_at,
    age_days: ageDays,
    href: null, // free accounts have no admin detail page yet
  };
}

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
    href: null,
  };
}

function shapeMember(m) {
  return {
    kind: 'member',
    id: m.id,
    full_name: m.full_name,
    email: m.email,
    photo_path: m.profile_photo_path || null,
    photo_url: m.photo_url || null,
    subscription_status: m.subscription_status,
    subscription_plan: m.subscription_plan,
    subscription_plan_display: PLAN_DISPLAY[m.subscription_plan] || m.subscription_plan || 'Unknown',
    subscription_period: m.subscription_period,
    current_period_end: m.current_period_end,
    member_since: m.created_at,
    monthly_cents: monthlyRecurringCents(m.subscription_plan, m.subscription_period),
    href: `/bananas/members/${m.id}`,
  };
}
