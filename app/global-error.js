'use client';

// App-wide fallback for uncaught client-side errors that escape every
// nested error.js boundary. Renders its own <html> + <body> because a
// global-error boundary replaces the whole document.
//
// Reports the crash to /api/client-error so we can actually see what
// went wrong in the field (there's no Sentry wired up yet). Never
// blocks and never rethrows.

import { useEffect } from 'react';

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    try {
      const payload = {
        source: 'global-error',
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
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px 24px',
          background: '#0a0a0a',
          color: '#ffffff',
          fontFamily:
            "'Plus Jakarta Sans', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
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
            {'This page hit a snag.'}
          </h1>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.6,
              color: 'rgba(255,255,255,0.65)',
              marginBottom: 24,
            }}
          >
            {'If you\u2019re trying to get into the venue, walk up to the front desk and give the door staff your name \u2014 they can check you in by hand.'}
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
        </div>
      </body>
    </html>
  );
}
