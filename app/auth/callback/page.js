'use client';

// OAuth callback landing page.
//
// Supabase Auth (Google, Apple, etc.) redirects here after a successful OAuth
// exchange. This page serves TWO callers, distinguished by what the caller
// asked for:
//
//   1. MOBILE APP HANDOFF \u2014 URL fragment contains the tokens and
//      ?return_to=<scheme>://... tells us which deep link to forward to:
//
//        https://sdgatx.com/auth/callback?return_to=sdgatx%3A%2F%2Fauth%2Fcallback#access_token=...&refresh_token=...
//
//      We forward the fragment onto the app's deep link and let the mobile
//      app pick up the session. This exists because Expo Go's redirect scheme
//      changes with every new dev-server IP; rather than re-allowlist each of
//      those in Supabase, the mobile app tells this page where to send the
//      token and this page forwards it. Supabase only needs one static entry
//      allowlisted forever: https://sdgatx.com/auth/callback.
//
//   2. WEB ACCOUNT-GATE FLOW \u2014 URL query contains ?code=... and ?next=...
//      This is the PKCE code-flow return from a browser-initiated Google
//      sign-in (see app/components/AccountGate.jsx). Middleware rewrites
//      these to /api/auth/callback so the code exchange runs server-side
//      where the PKCE verifier cookie is reliably readable. This client
//      page therefore never sees case (2) in normal operation.
//
// Discriminator: URL fragment with tokens \u2192 case (1). Otherwise fall back
// to the marketing home.
//
// Suspense wrapper: useSearchParams triggers a client-side-render bailout
// during static export in Next 15, which fails the build unless the consumer
// is wrapped in <Suspense>. We wrap the inner component below.

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

// Only allow relative same-origin paths as `next` to prevent open-redirect
// abuse (a crafted ?next=https://evil.example.com would otherwise send an
// authenticated user off-site right after signing in).
function safeNextPath(rawNext) {
  if (!rawNext) return '/';
  try {
    const decoded = decodeURIComponent(rawNext);
    if (decoded.startsWith('/') && !decoded.startsWith('//')) return decoded;
  } catch { /* fall through */ }
  return '/';
}

function AuthCallbackInner() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState('Completing sign-in\u2026');
  const [manualLink, setManualLink] = useState(null);

  useEffect(() => {
    const fragment = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    const returnTo = searchParams.get('return_to');
    const next = searchParams.get('next');

    // Case 1 \u2014 mobile-app fragment handoff.
    // (The PKCE web case is handled by middleware\u2192/api/auth/callback and
    // never reaches this page.)
    if (fragment && returnTo) {
      const deepLink = `${decodeURIComponent(returnTo)}#${fragment}`;
      setStatus('Returning to app\u2026');
      try { window.location.href = deepLink; } catch { /* fall through to link */ }
      setManualLink(deepLink);
      return;
    }

    if (fragment) {
      setStatus('Signed in. Redirecting\u2026');
      setTimeout(() => { window.location.href = safeNextPath(next); }, 500);
      return;
    }

    setStatus('No sign-in payload found. Return to the app and try again.');
  }, [searchParams]);

  return (
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
  );
}

export default function AuthCallbackPage() {
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
      <Suspense fallback={<div style={{ color: '#f5f5f5' }}>Completing sign-in\u2026</div>}>
        <AuthCallbackInner />
      </Suspense>
    </main>
  );
}
