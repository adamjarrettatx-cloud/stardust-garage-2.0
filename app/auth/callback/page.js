'use client';

// OAuth callback landing page.
//
// Supabase Auth (Google, Apple, etc.) redirects here after a successful
// OAuth exchange. The URL fragment contains the session tokens:
//
//   https://sdgatx.com/auth/callback?return_to=sdgatx%3A%2F%2Fauth%2Fcallback#access_token=...&refresh_token=...
//
// This page's job is to forward those tokens back into the mobile app
// via whatever deep link the app told us to use (`?return_to=<scheme>`).
//
// Why this lives on the website rather than being handled purely in
// Supabase config: Expo Go's redirect scheme changes with every new
// dev-server IP (exp://192.168.1.233:8081/... today, exp://... tomorrow).
// Rather than re-allowlist each of those in Supabase, the mobile app
// tells this page where to send the token and this page forwards it.
// Supabase only needs one static entry allowlisted forever:
//   https://sdgatx.com/auth/callback
//
// If `return_to` is missing (direct hit, or a future web sign-in), we
// fall back to the marketing home; a future web-app codebase can extend
// this page to set a Supabase cookie session in that case.

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function AuthCallbackPage() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState('Completing sign-in...');
  const [manualLink, setManualLink] = useState(null);

  useEffect(() => {
    const fragment = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    if (!fragment) {
      setStatus('No sign-in payload found. Return to the app and try again.');
      return;
    }

    const returnTo = searchParams.get('return_to');

    if (returnTo) {
      const deepLink = `${decodeURIComponent(returnTo)}#${fragment}`;
      setStatus('Returning to app...');
      // window.location.href supports custom schemes (sdgatx://, exp://).
      // Some Safari versions block programmatic scheme navigation without
      // a user gesture; render a manual tap link as a fallback.
      try { window.location.href = deepLink; } catch { /* fall through to link */ }
      setManualLink(deepLink);
      return;
    }

    setStatus('Signed in. Redirecting...');
    setTimeout(() => { window.location.href = '/'; }, 500);
  }, [searchParams]);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0a0a',
        color: '#f5f5f5',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: 24,
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <div style={{ fontSize: 14, letterSpacing: 2, color: '#d9c48c', marginBottom: 16 }}>
          STARDUST GARAGE
        </div>
        <div style={{ fontSize: 20, fontWeight: 500 }}>{status}</div>
        {manualLink && (
          <div style={{ marginTop: 24 }}>
            <a
              href={manualLink}
              style={{
                display: 'inline-block',
                padding: '12px 24px',
                background: '#d9c48c',
                color: '#0a0a0a',
                textDecoration: 'none',
                borderRadius: 999,
                fontWeight: 600,
              }}
            >
              Open in app
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
