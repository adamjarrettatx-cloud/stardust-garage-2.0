// Single source of truth for which events are public-facing.
//
// Internal "micro party" events live in the same `events` table as normal
// events (they need the same contracts, SignNow, financials, and POS plumbing)
// but must never appear on the public /events list, the public /events/[slug]
// detail page, or any member-facing event surface. They are gated by
// events.visibility: 'public' is shown to the world, 'internal' is admin/team
// only. See migration 20260616_event_visibility_micro_party.sql.
//
// Pure, dependency-free helpers so they can be unit-tested and reused by every
// public query without each page re-deriving the rule.

export const PUBLIC_VISIBILITY = 'public';
export const INTERNAL_VISIBILITY = 'internal';
export const MICRO_PARTY_TYPE = 'micro_party';

// True when an event row may be shown to the public / members. Treats a missing
// visibility (pre-migration rows, or a partial select) as public, matching the
// column default, so nothing that should be visible is ever hidden by accident.
export function isPublicEvent(event) {
  if (!event) return false;
  return (event.visibility ?? PUBLIC_VISIBILITY) === PUBLIC_VISIBILITY;
}

export function isInternalEvent(event) {
  return !!event && event.visibility === INTERNAL_VISIBILITY;
}

export function isMicroParty(event) {
  return !!event && event.event_type === MICRO_PARTY_TYPE;
}
