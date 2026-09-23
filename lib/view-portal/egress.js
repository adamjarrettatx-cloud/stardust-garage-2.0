import { PREVIEW_PROJECT_REF, viewConfig } from './config.js';

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
  viewConfig(); // Fail startup if accidentally configured against production.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    if (!sandboxFetchAllowed(url)) throw new Error('External integration blocked in View Portal');
    // Do not permit an allowlisted server to redirect credentials elsewhere.
    return originalFetch(input, { ...init, redirect: 'error' });
  };
}
