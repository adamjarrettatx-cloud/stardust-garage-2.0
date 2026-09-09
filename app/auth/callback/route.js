// OAuth callback route handler.
//
// Supabase Auth (Google, Apple, etc.) redirects here after the identity
// provider completes. There are TWO callers on this same URL, and we
// discriminate by what's in the request:
//
//   1. WEB PKCE FLOW — the URL carries ?code=... in the query string.
//      This is what AccountGate.jsx kicks off from InternalTicketModal
//      when a buyer clicks "Continue with Google" on an event page.
//      The PKCE code_verifier lives in an HTTP-only-ish cookie written
//      by @supabase/ssr's browser client at the start of the flow.
//      We MUST exchange the code server-side here so:
//        (a) the same cookie interface that wrote the verifier can read
//            it back, and
//        (b) the newly minted session cookies (sb-<ref>-auth-token +
//            refresh) are written from a Route Handler, which is one of
//            the only Next.js contexts allowed to Set-Cookie. When the
//            exchange was done from a Client Component page, our root
//            <Navbar> server component instantiated a Supabase server
//            client on the same request and silently swallowed the
//            cookie writes (Server Components can't set cookies),
//            leading to "PKCE code verifier not found in storage" on
//            the browser-side retry because the code had already been
//            burned server-side without the cookies being persisted.
//            Handling the exchange in a Route Handler cleanly avoids
//            that whole class of problem.
//
//   2. MOBILE APP DEEP-LINK HANDOFF — the URL fragment (#access_token=…)
//      carries the tokens and ?return_to=<scheme>://… tells us which
//      deep link to forward to. URL fragments never reach the server,
//      so a request with NO ?code (and no ?token_hash) is either the
//      mobile handoff or an accidental visit. We respond with a small
//      HTML shell whose inline script inspects window.location.hash and
//      forwards the fragment to the return_to deep link. This exists
//      because Expo Go's redirect scheme changes with every dev-server
//      IP; keeping a single static Supabase-allowlisted URL
//      (https://sdgatx.com/auth/callback) removes that maintenance
//      burden.
//
// A third caller reaches this URL when someone clicks a magic-link or
// invite-token email (?token_hash=…). We fall through to a small
// magic-link exchange on the server too, but only for the sign-in-with-
// token case — the recovery/verify flows have their own routes.

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  RETURN_TO_ALLOWED_SCHEMES,
  isAllowedReturnTo,
} from '@/lib/auth-callback-return-to';

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

function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

// Build the Supabase server client bound to Next's cookies() so cookie
// writes (session + refresh) actually persist on the outgoing response.
async function makeServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        },
      },
    },
  );
}

// HTML shell for the fragment-forwarding branch. We can't do this
// server-side because URL fragments are never sent to the server; we
// hand the browser a tiny script that reads window.location.hash and
// bounces to the deep link. Kept intentionally minimal — no React, no
// framework overhead, no external assets.
function fragmentHandoffHtml(allowedReturnTo) {
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Signing you in — Stardust Garage</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  html,body{margin:0;height:100%;background:#0a0a0a;color:#f5f5f5;font-family:system-ui,-apple-system,sans-serif}
  main{min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{text-align:center;max-width:420px}
  .brand{font-size:14px;letter-spacing:2px;color:#d9c48c;margin-bottom:16px}
  h1{font-size:20px;font-weight:500;margin:0}
  a.btn{display:inline-block;margin-top:24px;padding:12px 24px;background:#d9c48c;color:#0a0a0a;text-decoration:none;border-radius:999px;font-weight:600}
</style>
</head>
<body>
<main>
  <div class="card">
    <div class="brand">STARDUST GARAGE</div>
    <h1 id="status">Completing sign-in…</h1>
    <div id="manual"></div>
  </div>
</main>
<script>
(function () {
  var params = new URLSearchParams(window.location.search);
  var next = params.get('next');
  // SECURITY (C-01): return_to is validated SERVER-SIDE against an
  // allowlist. The server passes the pre-validated value in as
  // ALLOWED_RETURN_TO; if the client-side value ever differs, refuse to
  // forward the fragment.
  var serverAllowedReturnTo = ALLOWED_RETURN_TO_PLACEHOLDER;
  var returnTo = params.get('return_to');
  var fragment = window.location.hash ? window.location.hash.slice(1) : '';

  function safeNext(raw) {
    if (!raw) return '/';
    try {
      var d = decodeURIComponent(raw);
      if (d.charAt(0) === '/' && d.charAt(1) !== '/') return d;
    } catch (e) {}
    return '/';
  }

  // Mobile deep-link handoff: forward the fragment (which carries the
  // tokens) ONLY when the server validated the return_to against the
  // allowlist. An attacker-controlled return_to falls through to the
  // error path below, session tokens are never rendered off-origin.
  if (fragment && serverAllowedReturnTo && returnTo) {
    var deepLink = serverAllowedReturnTo + '#' + fragment;
    document.getElementById('status').textContent = 'Returning to app…';
    try { window.location.href = deepLink; } catch (e) {}
    document.getElementById('manual').innerHTML =
      '<a class="btn" href="' + deepLink.replace(/"/g, '&quot;') + '">Open in app</a>';
    return;
  }

  // Fragment present but return_to missing or unlisted: treat as a
  // same-site sign-in and bounce home. Do NOT echo the untrusted return_to.
  if (fragment) {
    if (returnTo && !serverAllowedReturnTo) {
      document.getElementById('status').textContent =
        'Sign-in destination not recognized. Returning to Stardust Garage.';
    } else {
      document.getElementById('status').textContent = 'Signed in. Redirecting…';
    }
    setTimeout(function () { window.location.href = safeNext(next); }, 500);
    return;
  }

  document.getElementById('status').textContent =
    'No sign-in payload found. Return to the previous page and try again.';
})();
</script>
</body>
</html>`;
  // Inject the server-validated return_to as a JSON string literal (safe
  // against '</script>' injection because it's already a URL that has been
  // parsed by WHATWG URL — no HTML-significant characters survive).
  const allowedReturnToJson = allowedReturnTo
    ? JSON.stringify(allowedReturnTo).replace(/</g, '\\u003c')
    : 'null';
  const finalBody = body.replace('ALLOWED_RETURN_TO_PLACEHOLDER', allowedReturnToJson);
  return new NextResponse(finalBody, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // No caching — this page carries auth-flow context in its URL.
      'cache-control': 'no-store, max-age=0',
      // Belt-and-braces: never leak URL params (which may include return_to,
      // ?next=, etc.) via Referer to whatever we bounce to.
      'referrer-policy': 'no-referrer',
    },
  });
}

// Render a same-shaped HTML page with an error message, but no forwarding.
// Used for PKCE exchange failures so the user sees what happened instead of
// bouncing them silently.
function errorHtml(message) {
  const safe = String(message || 'Sign-in failed.').replace(/[<&"']/g, (c) =>
    ({ '<': '&lt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])
  );
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Sign-in failed — Stardust Garage</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  html,body{margin:0;height:100%;background:#0a0a0a;color:#f5f5f5;font-family:system-ui,-apple-system,sans-serif}
  main{min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{text-align:center;max-width:520px}
  .brand{font-size:14px;letter-spacing:2px;color:#d9c48c;margin-bottom:16px}
  h1{font-size:20px;font-weight:500;margin:0 0 12px}
  p{opacity:.85;line-height:1.5}
  a.btn{display:inline-block;margin-top:24px;padding:12px 24px;background:#d9c48c;color:#0a0a0a;text-decoration:none;border-radius:999px;font-weight:600}
</style>
</head>
<body>
<main>
  <div class="card">
    <div class="brand">STARDUST GARAGE</div>
    <h1>Sign-in didn't complete</h1>
    <p>${safe}</p>
    <a class="btn" href="/">Back to Stardust Garage</a>
  </div>
</main>
</body>
</html>`;
  return new NextResponse(body, {
    status: 400,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
    },
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type'); // magiclink | signup | recovery | invite …
  const next = searchParams.get('next');

  // Dev fallback: if Supabase isn't configured (local sandbox), just bounce
  // home so the app doesn't 500 on smoke tests. Real deployments always have
  // these envs set.
  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(new URL(safeNextPath(next), request.url));
  }

  // ---- PKCE code exchange (web AccountGate flow) --------------------------
  if (code) {
    const supabase = await makeServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // Common causes we've seen in the wild:
      //   • the code was already redeemed (double-click / user hit back)
      //   • the code_verifier cookie was never written (browser blocked
      //     cookies for the sign-in domain)
      //   • the OAuth flow crossed hosts (apex vs www) and the verifier
      //     cookie didn't come along
      console.error('Auth callback exchangeCodeForSession failed:', error.message);
      return errorHtml(error.message);
    }
    return NextResponse.redirect(new URL(safeNextPath(next), request.url));
  }

  // ---- Magic link / email-token exchange ---------------------------------
  // (Kept here so an existing email-link flow arriving at this URL doesn't
  // fall through to the "no payload found" screen.)
  if (tokenHash && type) {
    const supabase = await makeServerSupabase();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (error) {
      console.error('Auth callback verifyOtp failed:', error.message);
      return errorHtml(error.message);
    }
    return NextResponse.redirect(new URL(safeNextPath(next), request.url));
  }

  // ---- Fragment handoff (mobile) OR bare visit --------------------------
  // Fragments never reach the server, so we return an HTML shell whose
  // inline JS forwards to the return_to deep link when the fragment is
  // present client-side.
  //
  // SECURITY (C-01): Validate return_to against the allowlist HERE, not in
  // client JS. The server passes the validated URL (or null) into the
  // shell; the client refuses to forward a fragment when return_to is not
  // on the allowlist. This blocks the open-redirect / session-exfil vector.
  const rawReturnTo = searchParams.get('return_to');
  const allowedReturnTo = isAllowedReturnTo(rawReturnTo)
    ? decodeURIComponent(rawReturnTo)
    : null;
  return fragmentHandoffHtml(allowedReturnTo);
}
