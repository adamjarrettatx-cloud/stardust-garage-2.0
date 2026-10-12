import { PREVIEW_PROJECT_REF, sandboxRuntimeConfig, viewConfig } from './config.js';

export function sandboxFetchAllowed(raw, init = {}) {
  try {
    const url = new URL(raw);
    if (!(url.protocol === 'https:' && url.hostname === `${PREVIEW_PROJECT_REF}.supabase.co`
      && !url.username && !url.password && !url.port
      && /^\/(auth|rest|storage)\/v1\//.test(decodeURIComponent(url.pathname)))) return false;
    const path = decodeURIComponent(url.pathname);
    const method = String(init.method || 'GET').toUpperCase();
    if (path.startsWith('/auth/v1/')) {
      const allowed = {
        '/auth/v1/user': ['GET'],
        '/auth/v1/settings': ['GET'],
        '/auth/v1/.well-known/jwks.json': ['GET'],
        '/auth/v1/token': ['POST'],
        '/auth/v1/verify': ['POST'],
        '/auth/v1/logout': ['POST'],
        '/auth/v1/factors': ['GET'],
        '/auth/v1/admin/generate_link': ['POST'],
      };
      return allowed[path]?.includes(method) || false;
    }
    return true;
  } catch { return false; }
}
export function installSandboxEgressGuard() {
  if (process.env.VIEW_PORTAL_MODE !== 'sandbox') return;
  sandboxRuntimeConfig(); // Never boot with the live database or live integrations.
  let ready = false;
  try { viewConfig(); ready = true; } catch { /* Locked bootstrap has no network access. */ }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (!ready) throw new Error('Network access blocked while View Portal is locked');
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const method = init?.method || (typeof input === 'object' ? input.method : undefined);
    if (!sandboxFetchAllowed(url, { method })) throw new Error('External integration blocked in View Portal');
    // Do not permit an allowlisted server to redirect credentials elsewhere.
    return originalFetch(input, { ...init, redirect: 'error' });
  };
}
