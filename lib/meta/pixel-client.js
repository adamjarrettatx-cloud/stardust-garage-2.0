'use client';

// Browser-side Meta Pixel helpers. Every function is a silent no-op unless
// the pixel is configured AND the current page is allowed by lib/meta/policy.
// Purchase/Subscribe are deliberately NOT sent from the browser; the Stripe
// webhook sends them server-side after payment is confirmed.

import { isMetaTrackablePath, META_APP_OPTOUT_COOKIE } from '@/lib/meta/policy';

export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || '';

export function metaBlockedInThisBrowser() {
  if (typeof window === 'undefined') return true;
  if (!META_PIXEL_ID) return true;
  if (navigator.globalPrivacyControl === true) return true;
  if (document.cookie.split(';').some((c) => c.trim().startsWith(`${META_APP_OPTOUT_COOKIE}=`))) return true;
  return false;
}

export function metaAllowedHere() {
  if (metaBlockedInThisBrowser()) return false;
  return isMetaTrackablePath(window.location.pathname, window.location.search);
}

// Installs Meta's standard fbq stub and loads fbevents.js once.
export function ensureMetaPixel() {
  if (typeof window === 'undefined' || window.__sdgMetaPixelReady) return;
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
  document,'script','https://connect.facebook.net/en_US/fbevents.js');
  // No automatic button/form scanning: only the events below are sent.
  window.fbq('set', 'autoConfig', false, META_PIXEL_ID);
  window.fbq('init', META_PIXEL_ID);
  window.__sdgMetaPixelReady = true;
}

export function trackMetaEvent(name, params = {}, options = {}) {
  try {
    if (!metaAllowedHere()) return;
    ensureMetaPixel();
    if (options.eventID) window.fbq('track', name, params, { eventID: options.eventID });
    else window.fbq('track', name, params);
  } catch {
    // Measurement must never break the page.
  }
}
