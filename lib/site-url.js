// Where is this deployment reachable from the outside?
//
// Anything we hand to a third party — a link in an email, a Stripe success_url
// — has to be absolute, and getting the host wrong is invisible until someone
// clicks it. The old convention (`request.headers.get('origin') || production`)
// broke on Vercel previews: every branch gets its own hostname, so an invite
// triggered from a preview had to be right about the request headers or it
// silently pointed at production.
//
// Vercel tells the deployment its own hostname, which beats trusting a header
// the caller controls, so the order is:
//
//   1. NEXT_PUBLIC_SITE_URL — explicit override, wins everywhere.
//   2. Production on Vercel — VERCEL_PROJECT_PRODUCTION_URL is the custom
//      domain (sdgatx.com). VERCEL_URL is NOT: in production it is the
//      per-deployment `*.vercel.app` hostname, which would put an ugly and
//      short-lived host in customer email.
//   3. Preview on Vercel — VERCEL_BRANCH_URL is stable for the life of the
//      branch, where VERCEL_URL changes on every commit. A link that outlives
//      the deployment that sent it is the whole point.
//   4. Local dev — the request's own origin (http://localhost:3000).
//   5. Nothing else known: production.
export const PRODUCTION_SITE_URL = 'https://sdgatx.com';

function normalize(value) {
  const trimmed = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// `request` is optional — routes that have one should pass it so local dev
// resolves to localhost instead of production.
export function resolveSiteUrl(request, env = process.env) {
  const explicit = normalize(env.NEXT_PUBLIC_SITE_URL);
  if (explicit) return explicit;

  if (env.VERCEL_ENV === 'production') {
    return normalize(env.VERCEL_PROJECT_PRODUCTION_URL) || PRODUCTION_SITE_URL;
  }

  const deployment = normalize(env.VERCEL_BRANCH_URL) || normalize(env.VERCEL_URL);
  if (deployment) return deployment;

  const origin = normalize(request?.headers?.get('origin'));
  if (origin) return origin;

  return PRODUCTION_SITE_URL;
}
