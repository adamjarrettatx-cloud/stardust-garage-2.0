export const VIEWPORT_PRESETS = Object.freeze([
  { width: 375, height: 812, label: 'Small phone · 375 px' },
  { width: 390, height: 844, label: 'Phone · 390 px' },
  { width: 430, height: 932, label: 'Large phone · 430 px' },
]);

export function safePreviewPath(value, origin) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || /^\/view-preview(?:\/|$)/.test(url.pathname)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
