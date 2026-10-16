// In-app browser detection.
//
// Links tapped inside Instagram, Facebook, Messenger, TikTok and similar apps
// open in the app's embedded web view, not Safari or Chrome. Google refuses
// OAuth inside embedded web views (403 disallowed_useragent), so "Continue
// with Google" dead-ends there. Email/password sign-in works normally.
//
// Pure functions so they can be unit tested without a DOM.

const SIGNATURES = [
  { app: 'Instagram', test: /Instagram/i },
  { app: 'Facebook', test: /FBAN|FBAV|FB_IAB|FB4A|FBIOS/i },
  { app: 'Messenger', test: /Messenger|MessengerForiOS|Orca-Android/i },
  { app: 'TikTok', test: /musical_ly|Bytedance|BytedanceWebview|TikTok/i },
  { app: 'Snapchat', test: /Snapchat/i },
  { app: 'Threads', test: /Barcelona/i },
  { app: 'LinkedIn', test: /LinkedInApp/i },
  { app: 'Pinterest', test: /Pinterest/i },
  { app: 'X', test: /Twitter/i },
  { app: 'LINE', test: /\bLine\//i },
];

export function detectInAppBrowser(userAgent = '') {
  const ua = String(userAgent || '');
  const platform = /iPhone|iPad|iPod/i.test(ua) ? 'ios' : /Android/i.test(ua) ? 'android' : 'other';
  for (const { app, test } of SIGNATURES) {
    if (test.test(ua)) return { inApp: true, app, platform };
  }
  // Generic Android WebView marker ("; wv)") without a named host app.
  if (platform === 'android' && /;\s*wv\)/i.test(ua)) {
    return { inApp: true, app: null, platform };
  }
  return { inApp: false, app: null, platform };
}

// URL that asks the OS to open `href` in the real browser.
//   iOS 17+: x-safari-https:// opens Safari directly.
//   Android: intent:// launches Chrome (falls back to the system chooser).
// Host apps sometimes ignore these, so callers always also offer Copy link
// and the app's own "Open in external browser" menu instruction.
export function externalBrowserUrl(href, platform) {
  let url;
  try { url = new URL(href); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  if (platform === 'ios') {
    return `x-safari-https://${url.host}${url.pathname}${url.search}${url.hash}`;
  }
  if (platform === 'android') {
    const fallback = encodeURIComponent(url.toString());
    return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
  }
  return null;
}
