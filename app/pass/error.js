'use client';

// Route-level error boundary for /pass and /pass/[token].
//
// Why this exists: the pass page is a critical guest-facing surface. A crash
// here means a guest at the door cannot show their QR, and the previous
// behavior — Next.js's default "Application error: a client-side exception
// has occurred" — gave them no way out. This boundary catches the throw,
// reports it to /api/client-error so we can see what happened, and shows a
// graceful fallback that reminds the guest they can still be checked in by
// name at the front desk.

import { useEffect } from 'react';

export default function PassError({ error, reset }) {
  useEffect(() => {
    // Fire-and-forget report. Never blocks the guest and never rethrows.
    try {
      const payload = {
        message: (error && error.message) || String(error) || 'unknown',
        stack: (error && error.stack) || null,
        digest: (error && error.digest) || null,
        path: typeof window !== 'undefined' ? window.location.pathname : null,
        href: typeof window !== 'undefined' ? window.location.href : null,
      };
      fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  }, [error]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 24px',
        background: '#0a0a0a',
        color: '#ffffff',
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 440, textAlign: 'center' }}>
        <div
          style={{
            display: 'inline-block',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.2em',
            padding: '6px 14px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.18)',
            color: 'rgba(255,255,255,0.6)',
            marginBottom: 20,
          }}
        >
          SOMETHING GLITCHED
        </div>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
            lineHeight: 1.2,
            letterSpacing: '-0.02em',
            marginBottom: 12,
          }}
        >
          {'We couldn\u2019t load your pass on this device.'}
        </h1>
        <p
          style={{
            fontSize: 14,
            lineHeight: 1.6,
            color: 'rgba(255,255,255,0.65)',
            marginBottom: 24,
          }}
        >
          {'No problem \u2014 walk up to the front desk and give the door staff your name. We can check you in by hand.'}
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            appearance: 'none',
            border: 'none',
            background: '#ffffff',
            color: '#0a0a0a',
            padding: '14px 28px',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.16em',
            borderRadius: 999,
            cursor: 'pointer',
            textTransform: 'uppercase',
          }}
        >
          Try again
        </button>
        <p
          style={{
            fontSize: 11,
            lineHeight: 1.6,
            color: 'rgba(255,255,255,0.4)',
            marginTop: 20,
          }}
        >
          {'Your pass is still valid \u2014 this is only a display glitch.'}
        </p>
      </div>
    </div>
  );
}
