// Audience resolver for notification broadcasts.
//
// A notification's recipient list is NEVER "all members" — it's "every
// account with permission to see the thing this notification is about."
// That includes:
//
//   * Members         (any tier)       — via member_profiles
//   * Trial holders   (post-signup)     — auth.users row without an active
//                                         member_profile
//   * Guest ticket buyers               — auth.users row via orders
//   * Partners        (DJs, promoters)  — partner_profiles
//   * Team / admin                      — team_members
//
// This module turns an audience spec into a de-duplicated list of
// auth.users.id values. Server-only — always called with a service-role
// admin client.
//
// Audience shape:
//
//   { scope: 'all' }                              — every auth user
//   { scope: 'members' }                          — every active member profile
//   { scope: 'members', tier: 'iykyk' }           — The Insider tier only
//   { scope: 'members', tier: 'cowork' }          — The Builder tier only
//   { scope: 'trial' }                            — trial pass holders w/ account
//   { scope: 'partners' }                         — active partners
//   { scope: 'team' }                             — team_members (team + admin)
//   { scope: 'admin' }                            — admins only
//   { scope: 'event', eventId, event? }           — scope derived from event
//                                                   visibility + is_sdg_only +
//                                                   required_membership_tier
//
// Tier keys stay as the internal Stripe/DB values ('cowork', 'iykyk') so we
// never have to migrate data when marketing names change. Display labels
// come from lib/stripe-prices.js (PLAN_DISPLAY) — that is the single source
// of truth for what users see.

// Re-export MEMBERSHIP_TIER_KEYS from the canonical registry so callers of
// this module don't have to import from two files. Adding a new tier is a
// one-line change in lib/membership-tiers.js.
export { MEMBERSHIP_TIER_KEYS } from '../membership-tiers.js';
import { MEMBERSHIP_TIER_KEYS as _TIER_KEYS } from '../membership-tiers.js';

const ACTIVE_MEMBER_STATUSES = ['active', 'trialing'];

// ---------------------------------------------------------------------------
// Primitive queries
// ---------------------------------------------------------------------------

async function allAuthUserIds(admin) {
  // supabase-js exposes an admin.auth.admin.listUsers with pagination. Cap at
  // 10k for now — well above SDG's realistic user count; we'll paginate
  // properly if we ever cross it.
  const ids = [];
  try {
    let page = 1;
    while (page <= 20) { // safety valve
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 500 });
      if (error) {
        console.error('[audience.allAuthUserIds]', error.message);
        break;
      }
      const users = data?.users || [];
      for (const u of users) if (u?.id) ids.push(u.id);
      if (users.length < 500) break;
      page += 1;
    }
  } catch (err) {
    console.error('[audience.allAuthUserIds] threw', err?.message || err);
  }
  return ids;
}

async function memberUserIds(admin, { tier = null } = {}) {
  try {
    let q = admin
      .from('member_profiles')
      .select('user_id, subscription_plan, subscription_status, is_active')
      .not('user_id', 'is', null);
    if (tier) q = q.eq('subscription_plan', tier);
    const { data, error } = await q;
    if (error) {
      console.error('[audience.memberUserIds]', error.message);
      return [];
    }
    // Only active/trialing members (per subscription_status). is_active is the
    // op-team's override for pausing someone — respect it too.
    return (data || [])
      .filter((m) => m.is_active !== false)
      .filter((m) => !m.subscription_status || ACTIVE_MEMBER_STATUSES.includes(m.subscription_status))
      .map((m) => m.user_id);
  } catch (err) {
    console.error('[audience.memberUserIds] threw', err?.message || err);
    return [];
  }
}

async function trialHolderUserIds(admin) {
  // Trial pass holders who have an account: trial_passes joined to
  // member_profiles by member_profile_id gives us their user_id.
  try {
    const { data, error } = await admin
      .from('trial_passes')
      .select('member_profile_id')
      .not('member_profile_id', 'is', null);
    if (error) {
      console.error('[audience.trialHolderUserIds]', error.message);
      return [];
    }
    const ids = (data || []).map((r) => r.member_profile_id);
    if (ids.length === 0) return [];
    const { data: mps } = await admin
      .from('member_profiles')
      .select('user_id')
      .in('id', ids)
      .not('user_id', 'is', null);
    return (mps || []).map((m) => m.user_id);
  } catch (err) {
    console.error('[audience.trialHolderUserIds] threw', err?.message || err);
    return [];
  }
}

async function partnerUserIds(admin) {
  try {
    const { data, error } = await admin
      .from('partner_profiles')
      .select('user_id, is_active')
      .not('user_id', 'is', null)
      .eq('is_active', true);
    if (error) {
      console.error('[audience.partnerUserIds]', error.message);
      return [];
    }
    return (data || []).map((r) => r.user_id);
  } catch (err) {
    console.error('[audience.partnerUserIds] threw', err?.message || err);
    return [];
  }
}

async function teamUserIds(admin, { adminOnly = false } = {}) {
  try {
    let q = admin.from('team_members').select('user_id, role');
    if (adminOnly) q = q.eq('role', 'admin');
    const { data, error } = await q;
    if (error) {
      console.error('[audience.teamUserIds]', error.message);
      return [];
    }
    return (data || []).map((r) => r.user_id).filter(Boolean);
  } catch (err) {
    console.error('[audience.teamUserIds] threw', err?.message || err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Event-derived scope
// ---------------------------------------------------------------------------

// Given an event row (or an event id we can fetch), return the audience spec
// that matches its visibility + gating.
//
//   visibility='internal'        -> team-only (silent in-app)
//   required_membership_tier set -> that specific tier (e.g. Insider-only)
//   is_sdg_only=true             -> members-only (all tiers)
//   otherwise                    -> everyone with an account
export async function audienceForEvent(admin, { eventId, event }) {
  let ev = event;
  if (!ev && eventId) {
    try {
      const { data } = await admin
        .from('events')
        .select('id, visibility, is_sdg_only, required_membership_tier')
        .eq('id', eventId)
        .maybeSingle();
      ev = data || null;
    } catch (err) {
      console.error('[audience.forEvent] fetch', err?.message || err);
    }
  }
  if (!ev) return { scope: 'all' };

  if (ev.visibility === 'internal') return { scope: 'team' };
  if (ev.required_membership_tier && _TIER_KEYS.includes(ev.required_membership_tier)) {
    return { scope: 'members', tier: ev.required_membership_tier };
  }
  if (ev.is_sdg_only) return { scope: 'members' };
  return { scope: 'all' };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

// Resolve an audience spec to a de-duplicated list of auth.users.id values.
// Never throws. Returns [] on any error — the broadcaster then sends
// nothing rather than blowing up.
export async function resolveAudience(admin, audience) {
  if (!admin || !audience || !audience.scope) return [];

  let ids = [];
  switch (audience.scope) {
    case 'all':
      ids = await allAuthUserIds(admin);
      break;
    case 'members':
      ids = await memberUserIds(admin, { tier: audience.tier || null });
      break;
    case 'trial':
      ids = await trialHolderUserIds(admin);
      break;
    case 'partners':
      ids = await partnerUserIds(admin);
      break;
    case 'team':
      ids = await teamUserIds(admin, { adminOnly: false });
      break;
    case 'admin':
      ids = await teamUserIds(admin, { adminOnly: true });
      break;
    case 'event': {
      const spec = await audienceForEvent(admin, {
        eventId: audience.eventId,
        event: audience.event,
      });
      return resolveAudience(admin, spec); // recurse into the derived scope
    }
    default:
      console.error('[audience.resolve] unknown scope', audience.scope);
      return [];
  }

  // De-dupe. A user could match multiple pools (e.g. team member who's also
  // a member) — only notify once.
  return Array.from(new Set(ids.filter(Boolean)));
}
