export function safeMobileReturnPath(raw, origin) {
  if (typeof raw !== 'string' || !/^\/(?!\/)/.test(raw) || /[\u0000-\u0020\\]/.test(raw)) return '/';
  try {
    const url = new URL(raw, origin);
    if (url.origin !== new URL(origin).origin || url.username || url.password) return '/';
    if (/^\/(?:handoff|auth\/callback)(?:\/|$)/.test(url.pathname)) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/'; }
}
