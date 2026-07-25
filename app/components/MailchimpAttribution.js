'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

// Mounted once in the root layout. Notices when someone lands on the site
// from a Mailchimp email (Mailchimp auto-appends mc_cid + mc_eid to every
// link in a campaign), and:
//   1. Remembers it in a 45-day cookie, so later navigation on the site still
//      knows "this visit came from campaign X" even after the query params
//      are gone from the URL.
//   2. Fires a one-time, fire-and-forget log to our own API so we have a
//      server-side record of the click (resolved to an email address) to
//      match against Ticket Tailor orders later. This does NOT depend on the
//      visitor ever reaching a specific "buy tickets" page — an open+click on
//      any page counts.
//
// Deliberately silent/best-effort: a failure here must never affect the
// visitor's experience of the site.
const COOKIE_MAX_AGE_DAYS = 45;

function setCookie(name, value) {
  const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

export default function MailchimpAttribution() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const mcCid = searchParams?.get('mc_cid');
    const mcEid = searchParams?.get('mc_eid');
    if (!mcCid && !mcEid) return;

    if (mcCid) setCookie('mc_cid', mcCid);
    if (mcEid) setCookie('mc_eid', mcEid);

    // De-dupe: only log once per (mc_cid, mc_eid) pair per browser, so
    // repeated navigation within the same email visit doesn't spam clicks.
    const dedupeKey = `mc_click_logged:${mcCid || ''}:${mcEid || ''}`;
    if (sessionStorage.getItem(dedupeKey)) return;
    sessionStorage.setItem(dedupeKey, '1');

    fetch('/api/marketing/track-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mc_cid: mcCid, mc_eid: mcEid, path: pathname }),
      keepalive: true,
    }).catch(() => {});
  }, [searchParams, pathname]);

  return null;
}
