'use client';

// Shown in place of the Google button when the page is open inside an app's
// built-in browser (Instagram, Facebook, TikTok...). Google blocks sign-in
// there, so we point the guest to Safari/Chrome or to the email form below.

import { useEffect, useState } from 'react';
import { detectInAppBrowser, externalBrowserUrl } from '@/lib/in-app-browser';

// Client-only detection. `checked` stays false during SSR and the first
// client render so server and client markup match.
export function useInAppBrowser() {
  const [state, setState] = useState({ checked: false, inApp: false, app: null, platform: 'other' });
  useEffect(() => {
    setState({ checked: true, ...detectInAppBrowser(navigator.userAgent) });
  }, []);
  return state;
}

export default function InAppBrowserNotice({ app, platform, mode = 'signup' }) {
  const [copied, setCopied] = useState(false);
  const appName = app || 'this app';
  const browserName = platform === 'android' ? 'Chrome' : 'Safari';
  const menuHint = platform === 'android'
    ? 'Or tap \u22EE at the top right and choose Open in Chrome.'
    : 'Or tap \u2022\u2022\u2022 at the top right and choose Open in external browser.';

  function openExternal() {
    const target = externalBrowserUrl(window.location.href, platform);
    if (target) window.location.href = target;
  }

  async function copyLink() {
    const href = window.location.href;
    try {
      await navigator.clipboard.writeText(href);
    } catch {
      // Older web views without the async clipboard API.
      const ta = document.createElement('textarea');
      ta.value = href;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* nothing else to try */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  const canOpen = platform === 'ios' || platform === 'android';

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.12)' }}
      role="note"
    >
      <div className="text-[13px] font-semibold mb-1" style={{ color: '#f5f5f5' }}>
        Google sign-in doesn&rsquo;t work inside {appName}.
      </div>
      <div className="text-[13px] mb-3.5 leading-[1.45]" style={{ color: '#a0a0a0' }}>
        {mode === 'signin'
          ? <>Sign in with your email below, or open this page in {browserName} to use Google.</>
          : <>Create your account with email below, or open this page in {browserName} to use Google.</>}
      </div>
      <div className="flex gap-2">
        {canOpen && (
          <button
            type="button"
            onClick={openExternal}
            className="flex-1 py-3 rounded-full text-[11px] font-semibold tracking-[0.14em]"
            style={{ background: '#ffffff', color: '#0a0a0a' }}
          >
            OPEN IN {browserName.toUpperCase()}
          </button>
        )}
        <button
          type="button"
          onClick={copyLink}
          className="flex-1 py-3 rounded-full text-[11px] font-semibold tracking-[0.14em] border"
          style={{ background: 'transparent', borderColor: 'rgba(255,255,255,0.2)', color: '#f5f5f5' }}
        >
          {copied ? 'LINK COPIED' : 'COPY LINK'}
        </button>
      </div>
      <div className="text-[12px] mt-3" style={{ color: '#8a8a8a' }}>{menuHint}</div>
    </div>
  );
}
