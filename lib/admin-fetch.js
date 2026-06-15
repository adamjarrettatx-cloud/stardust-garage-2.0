// Client-side fetch wrapper for admin API calls.
//
// When ENFORCE_ADMIN_MFA is on and a session has dropped below aal2 mid-use
// (e.g. step-down or expiry), the admin APIs respond with
//   401 { error: 'Unauthorized', reason: 'mfa_required' }
// Page-level adminPageGate() already redirects on navigation, but an in-page
// action (save, upload, transition) would otherwise surface a bare
// "Unauthorized". This helper intercepts that case and sends the browser to the
// security page so the admin can step up, instead of showing a dead error.
//
// On success it returns the parsed JSON. On any other non-OK response it throws
// an Error carrying the server's `error`/`hint` message so existing catch
// blocks keep working unchanged.
export async function adminFetch(url, options) {
  const res = await fetch(url, options);

  let json = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON response (rare for these routes) — leave json null.
  }

  if (res.status === 401 && json?.reason === 'mfa_required') {
    if (typeof window !== 'undefined') {
      window.location.href = '/admin/security?mfa=required';
    }
    throw new Error('Multi-factor authentication required. Redirecting to security…');
  }

  if (!res.ok) {
    throw new Error(json?.hint || json?.error || 'Request failed');
  }

  return json;
}
