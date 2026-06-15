// Pure auth-classification helper for the event-metrics refresh route, split
// out so it can be unit-tested without importing the Next.js route (which pulls
// in next/server + server-only Supabase clients).
//
// Returns 'cron' for a valid `Bearer ${CRON_SECRET}` header, otherwise null.
// An empty/missing cronSecret never matches, so a misconfigured environment
// can't be bypassed with an empty Bearer token.
export function classifyCronAuth(authHeader, cronSecret) {
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return 'cron';
  return null;
}
