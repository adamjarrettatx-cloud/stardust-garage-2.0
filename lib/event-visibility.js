// Single source of truth for which events are public-facing.
//
// The events table has three visibility tiers (see migrations
// 20260616_event_visibility_micro_party.sql and
// 20260907_event_visibility_unlisted.sql):
//
//   * 'public'   → the default. Appears on every listing (/events, /home,
//                  the anon calendar, member surfaces) and renders at
//                  /events/[slug].
//   * 'unlisted' → NOT on any listing, but /events/[slug] renders for anyone
//                  with the link. Used for beta testing, invite-only events,
//                  and private venue rentals that still need to sell tickets
//                  through the site. Also emits `noindex` so search engines
//                  don't crawl the URL.
//   * 'internal' → hidden from every public/member surface. Micro parties and
//                  team-only events live here — admin/team see them on the
//                  team calendar and inside /bananas, everyone else can't
//                  reach them at all.
//
// Pure, dependency-free helpers so they can be unit-tested and reused by every
// public query without each page re-deriving the rule.

export const PUBLIC_VISIBILITY = 'public';
export const UNLISTED_VISIBILITY = 'unlisted';
export const INTERNAL_VISIBILITY = 'internal';
export const MICRO_PARTY_TYPE = 'micro_party';

// True when an event row may appear on public LISTINGS (/events, /home, the
// public calendar, member surfaces). Treats a missing visibility
// (pre-migration rows, or a partial select) as public, matching the column
// default, so nothing that should be visible is ever hidden by accident.
//
// Unlisted events are NOT considered listable — they're only reachable by
// direct URL. Use isReachableByLink() below for the detail-page rule.
export function isPublicEvent(event) {
  if (!event) return false;
  return (event.visibility ?? PUBLIC_VISIBILITY) === PUBLIC_VISIBILITY;
}

export function isUnlistedEvent(event) {
  return !!event && event.visibility === UNLISTED_VISIBILITY;
}

export function isInternalEvent(event) {
  return !!event && event.visibility === INTERNAL_VISIBILITY;
}

export function isMicroParty(event) {
  return !!event && event.event_type === MICRO_PARTY_TYPE;
}

// True when an anonymous visitor can open /events/[slug] and see the event
// (and buy tickets). Public and unlisted events both qualify; internal
// events never do. Callers should also confirm status === 'published' —
// drafts stay behind the admin preview route regardless of visibility.
export function isReachableByLink(event) {
  if (!event) return false;
  const v = event.visibility ?? PUBLIC_VISIBILITY;
  return v === PUBLIC_VISIBILITY || v === UNLISTED_VISIBILITY;
}
