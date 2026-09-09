// SECURITY (H-02): waiver-gate policy — fail closed in production.
//
// The ticket-hold endpoint historically read `WAIVER_GATE_ENABLED=='true'`
// as its only source of truth for whether every hold must carry a signed
// waiver envelope. That meant a missing env var, a typo, or a rollback of
// the Vercel dashboard silently disabled the gate — a hold with no waiver
// would still succeed, and the door had no legal cover for that ticket.
//
// New policy:
//   * production (NODE_ENV or VERCEL_ENV === 'production'): enforcement is
//     the DEFAULT. Set `WAIVER_GATE_ENABLED='false'` only as a documented
//     incident-response bypass. Missing / typo'd / any-other-value → ON.
//   * everywhere else (dev, preview, unit tests): opt-IN via
//     `WAIVER_GATE_ENABLED='true'` so local smoke-tests can hit /api/tickets/hold
//     without a signed waiver in the request body.
//
// `env` is passed in explicitly so tests don't have to mutate process.env.

/**
 * @param {Record<string, string | undefined>} [env=process.env]
 * @returns {boolean}
 */
export function resolveWaiverGateEnabled(env = process.env) {
  const isProd =
    env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
  const raw = env.WAIVER_GATE_ENABLED;
  if (isProd) return raw !== 'false';
  return raw === 'true';
}
