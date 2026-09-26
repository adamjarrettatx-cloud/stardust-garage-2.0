// Temporary, time-boxed switch that lets /pass issue a Trial SDG Pass without
// the Twilio SMS code — for nights when Twilio Verify is down or unfunded.
//
// Env var (server-only, set in Vercel):
//   TRIAL_PASS_SMS_BYPASS_UNTIL   ISO-8601 timestamp, e.g. 2026-09-26T11:00:00Z
//
// The bypass is active only while now < that timestamp, so it switches itself
// off without anyone remembering to unset it. Missing or unparseable values
// mean "off". Passes issued through the bypass keep phone_verified_at = null,
// so they stay distinguishable from verified signups.
export function isSmsBypassActive(now = new Date()) {
  const raw = process.env.TRIAL_PASS_SMS_BYPASS_UNTIL;
  if (!raw) return false;
  const until = Date.parse(raw);
  if (Number.isNaN(until)) return false;
  return now.getTime() < until;
}
