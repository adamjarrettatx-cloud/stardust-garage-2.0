// recent-activity.js — small, pure ring-buffer helpers for the front-desk
// "last 5" panel. Kept out of any React component so the trimming rule is
// unit-testable and identical whether the entry came from a guest-list
// check-in, a trial-pass scan, or a member-id verify.
//
// Each entry is a plain object:
//   {
//     id:      string,   // stable dedupe key (guestlist entry id, ticket id, member id, or a synthesized id)
//     kind:    'guestlist' | 'trial_pass' | 'member_id',
//     name:    string,   // guest name to render
//     detail:  string?,  // secondary text ("via ticket · GA", "no photo", etc.)
//     result:  'admitted' | 'rejected' | 'denied',
//     at:      number,   // Date.now() when this happened
//   }

export const RECENT_ACTIVITY_MAX = 5;

// pushRecentActivity(list, entry) — prepends the newest entry and dedupes by
// id (so the same guest tapped twice in a row does not fill the panel), then
// trims to RECENT_ACTIVITY_MAX. Never mutates the input.
export function pushRecentActivity(list, entry, max = RECENT_ACTIVITY_MAX) {
  if (!entry || typeof entry !== 'object') return Array.isArray(list) ? list : [];
  const base = Array.isArray(list) ? list.filter((e) => e && e.id !== entry.id) : [];
  return [entry, ...base].slice(0, max);
}

// formatActivityTime(ts) — 12-hour "h:mm AM/PM" for the panel. Kept here so
// the front-desk component and any future recent-activity export share it.
export function formatActivityTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}
