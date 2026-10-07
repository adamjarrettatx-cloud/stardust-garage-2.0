// Server-only. Captures the browser signals Meta needs to match a later
// server-side Purchase/Subscribe event to the ad click that caused it.
//
// The Stripe webhook runs on a request from Stripe, not the buyer, so these
// values are captured when checkout starts and carried in Stripe Checkout
// metadata (max 500 chars per value). Nothing is captured when Meta is not
// configured, when the visitor came from the mobile app, or when the browser
// sends Global Privacy Control.

import { hasAppOptOut } from './policy.js';

function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) {
      const v = rest.join('=');
      try { return decodeURIComponent(v); } catch { return v; }
    }
  }
  return null;
}

export function isMetaServerConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_META_PIXEL_ID && process.env.META_CAPI_ACCESS_TOKEN);
}

// Returns Stripe metadata entries (all strings) or {} when Meta must not
// receive this buyer's activity.
export function metaCheckoutMetadata(request) {
  if (!isMetaServerConfigured() || !request?.headers) return {};
  const h = request.headers;
  const cookieHeader = h.get('cookie') || '';
  if (hasAppOptOut(cookieHeader)) return { meta_optout: 'app' };
  // Bearer-token calls come straight from the mobile app, never a browser.
  if (/^bearer\s/i.test(h.get('authorization') || '')) return { meta_optout: 'app' };
  if (h.get('sec-gpc') === '1') return { meta_optout: 'gpc' };

  const forwarded = h.get('x-forwarded-for') || '';
  const ip = forwarded.split(',')[0].trim() || h.get('x-real-ip') || '';
  const ua = h.get('user-agent') || '';
  const fbp = readCookie(cookieHeader, '_fbp') || '';
  const fbc = readCookie(cookieHeader, '_fbc') || '';
  const referer = h.get('referer') || '';

  const out = { meta_ok: '1' };
  if (ip) out.meta_ip = ip.slice(0, 64);
  if (ua) out.meta_ua = ua.slice(0, 500);
  if (fbp) out.meta_fbp = fbp.slice(0, 200);
  if (fbc) out.meta_fbc = fbc.slice(0, 500);
  if (referer) {
    try {
      const u = new URL(referer);
      out.meta_src = `${u.origin}${u.pathname}`.slice(0, 500); // no query string
    } catch { /* ignore */ }
  }
  return out;
}

// Reads the values written above back out of Stripe metadata.
export function metaAttributionFromMetadata(md) {
  if (!md || md.meta_ok !== '1') return null;
  return {
    clientIp: md.meta_ip || null,
    userAgent: md.meta_ua || null,
    fbp: md.meta_fbp || null,
    fbc: md.meta_fbc || null,
    sourceUrl: md.meta_src || null,
  };
}
