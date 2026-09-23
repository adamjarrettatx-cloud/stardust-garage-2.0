export const LIVE_PROJECT_REF = 'iwgfelvbebqbaotkylsw';
export const PREVIEW_PROJECT_REF = 'ygcqwohfnijjaeoobwhj';
export const PREVIEW_COOKIE = '__Host-sdg-view';
export const PREVIEW_DURATION = 30 * 60;

function httpsOrigin(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('A dedicated HTTPS origin is required');
  }
  return url.origin;
}
// Infrastructure must be valid even while launch is locked. Owner credentials,
// signing material and acceptance flags remain required by viewConfig().
export function sandboxRuntimeConfig(env = process.env) {
  if (env.VIEW_PORTAL_MODE !== 'sandbox') throw new Error('Sandbox mode is required');
  const sandboxOrigin = httpsOrigin(env.VIEW_PORTAL_SANDBOX_ORIGIN);
  if (/^(www\.)?sdgatx\.com$/i.test(new URL(sandboxOrigin).hostname)) {
    throw new Error('Production cannot be the preview destination');
  }
  if (env.NEXT_PUBLIC_SUPABASE_URL !== `https://${PREVIEW_PROJECT_REF}.supabase.co`) {
    throw new Error('Sandbox must use the approved isolated database');
  }
  if (env.NEXT_PUBLIC_SITE_URL !== sandboxOrigin) throw new Error('Sandbox site URL must match its hostname');
  const forbidden = Object.keys(env).filter((name) =>
    /^(STRIPE|RESEND|MERCURY|MAILCHIMP|TWILIO|TICKETTAILOR|TICKET_TAILOR|AUTHORIZE|SIGNNOW|EXPO_ACCESS_TOKEN|CRON_SECRET)/.test(name)
    && env[name],
  );
  if (forbidden.length) throw new Error('Remove external integration credentials from the sandbox');
  return { sandboxOrigin };
}
// Never treat a malformed sandbox configuration as permission to run normally.
export function viewConfig(env = process.env) {
  const mode = env.VIEW_PORTAL_MODE;
  if (!['launcher', 'sandbox'].includes(mode)) throw new Error('View Portal is not configured');
  const sandboxOrigin = httpsOrigin(env.VIEW_PORTAL_SANDBOX_ORIGIN);
  const controllerOrigin = httpsOrigin(env.VIEW_PORTAL_CONTROLLER_ORIGIN);
  if (new URL(sandboxOrigin).hostname === new URL(controllerOrigin).hostname) {
    throw new Error('Preview and owner sessions require separate hostnames');
  }
  if (/^(www\.)?sdgatx\.com$/i.test(new URL(sandboxOrigin).hostname)) {
    throw new Error('Production cannot be the preview destination');
  }
  const ownerId = env.VIEW_PORTAL_OWNER_USER_ID;
  if (!/^[0-9a-f-]{36}$/i.test(ownerId || '')) throw new Error('Owner identity is not configured');
  const secret = env.VIEW_PORTAL_SIGNING_SECRET;
  if (!secret || secret.length < 43) throw new Error('Preview signing secret is not configured');
  if (env.VIEW_PORTAL_READY !== 'true') throw new Error('Test environment validation is incomplete');
  if (mode === 'sandbox') {
    sandboxRuntimeConfig(env);
    if (env.VIEW_PORTAL_ISOLATION_VERIFIED !== 'true') throw new Error('Sandbox isolation has not been verified');
  }
  return { mode, sandboxOrigin, controllerOrigin, ownerId, secret };
}
export function viewPortalStatus(env = process.env) {
  try {
    const config = viewConfig(env);
    return { ready: config.mode === 'launcher', message: 'Isolated test environment configured.' };
  } catch {
    return { ready: false, message: 'Launch is locked until the isolated schema, fixtures, deployment and safety checks are verified.' };
  }
}
