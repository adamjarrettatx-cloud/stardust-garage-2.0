// Shared Meta (Facebook/Instagram) measurement policy. Pure functions so the
// browser pixel, the server Conversions API sender, and tests all agree on
// exactly where Meta is allowed to see a visitor.
//
// Default posture is OFF: nothing loads unless NEXT_PUBLIC_META_PIXEL_ID is
// set, and server events additionally need META_CAPI_ACCESS_TOKEN.

// Visitors who arrive from the SDG mobile app (via /handoff) get this cookie.
// While it is present, neither the browser pixel nor the server sends Meta
// anything, so app-originated activity is never shared with Meta.
export const META_APP_OPTOUT_COOKIE = 'sdg_meta_off';
export const META_APP_OPTOUT_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Staff, admin, private-account and token-bearing routes. The pixel never
// loads on these, because Meta receives the full page URL with every event.
// A prefix blocks itself and everything under it.
const BLOCKED_PREFIXES = [
  '/admin', '/bananas', '/team', '/staff', '/clock', '/employee',
  '/capacity', '/scan', '/portal', '/collaborate', '/notifications',
  '/account', '/member', '/auth', '/login', '/forgot-password',
  '/reset-password', '/handoff', '/g', '/t', '/tickets', '/api',
];
// These public pages stay trackable, but their token-bearing children do not
// (e.g. /pass is the public Trial Pass form; /pass/<token> is a credential).
const BLOCKED_CHILDREN_ONLY = ['/pass'];

// Query parameters that carry capabilities or identifiers (share tokens,
// hold tokens, Mailchimp subscriber ids). A URL carrying any of them is not
// sent to Meta.
const SENSITIVE_PARAMS = ['t', 'token', 'hold', 'code', 'mc_eid', 'email', 'return_to'];

export function isMetaTrackablePath(pathname, search = '') {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return false;
  for (const p of BLOCKED_PREFIXES) {
    if (pathname === p || pathname.startsWith(`${p}/`)) return false;
  }
  for (const p of BLOCKED_CHILDREN_ONLY) {
    if (pathname.startsWith(`${p}/`)) return false;
  }
  if (search) {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    for (const key of SENSITIVE_PARAMS) if (params.has(key)) return false;
  }
  return true;
}

export function hasAppOptOut(cookieHeader) {
  if (!cookieHeader) return false;
  return cookieHeader.split(';').some((c) => c.trim().startsWith(`${META_APP_OPTOUT_COOKIE}=`));
}
