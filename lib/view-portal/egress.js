import { PREVIEW_PROJECT_REF, sandboxRuntimeConfig, viewConfig } from './config.js';

export function sandboxFetchAllowed(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === `${PREVIEW_PROJECT_REF}.supabase.co`
      && !url.username && !url.password && !url.port
      && /^\/(auth|rest|storage)\/v1\//.test(decodeURIComponent(url.pathname));
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
    if (!sandboxFetchAllowed(url)) throw new Error('External integration blocked in View Portal');
    // Do not permit an allowlisted server to redirect credentials elsewhere.
    return originalFetch(input, { ...init, redirect: 'error' });
  };
}
