// Server-side PKCE code exchange endpoint.
//
// Why this exists — not the /auth/callback page:
//   Google's OAuth PKCE flow puts the code verifier in a browser cookie when
//   `signInWithOAuth` runs. On return, `exchangeCodeForSession(code)` MUST
//   read that verifier from the same origin's cookies. @supabase/ssr writes
//   the verifier as an HttpOnly-friendly cookie that is safest to read on the
//   server — the client-side exchange sometimes fires before the browser has
//   fully committed the cookie back into `document.cookie`, and users see
//   "PKCE code verifier not found in storage".
//
// Flow:
//   1. AccountGate calls signInWithOAuth({ redirectTo: `${origin}/auth/callback?next=…` })
//   2. Middleware detects `?code=` on /auth/callback and rewrites the request
//      to /api/auth/callback (this file) so the server owns the exchange.
//   3. We read the code + next from the query, exchange server-side with
//      the SSR client (which writes the session cookies onto the response),
//      then 302 the user to `next` (already same-origin-safe validated).
//
// Mobile fragment handoff is UNAFFECTED — those requests never have `?code=`
// so middleware leaves them alone and they hit the client `page.js` as before.

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Same allowlist rule the client page uses — see app/auth/callback/page.js.
// Prevents open-redirect abuse: a crafted ?next=https://evil.example would
// otherwise send the newly-signed-in user off-site.
function safeNextPath(rawNext) {
  if (!rawNext) return '/';
  try {
    const decoded = decodeURIComponent(rawNext);
    if (decoded.startsWith('/') && !decoded.startsWith('//')) return decoded;
  } catch { /* fall through */ }
  return '/';
}

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNextPath(searchParams.get('next'));
  const errorParam = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  // Provider (Google) declined or returned an error — bounce back to the
  // origin page with a friendly note; nothing to exchange.
  if (errorParam) {
    const dest = new URL(next, origin);
    dest.searchParams.set('auth_error', errorDescription || errorParam);
    return NextResponse.redirect(dest);
  }

  if (!code) {
    // Shouldn't happen given the middleware rewrite rule, but if someone hits
    // this URL directly with no code, send them home instead of 500ing.
    return NextResponse.redirect(new URL('/', origin));
  }

  const cookieStore = await cookies();
  const response = NextResponse.redirect(new URL(next, origin));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        // Session cookies (sb-<ref>-auth-token, sb-<ref>-auth-token.0, .1)
        // must land on the OUTGOING response so the browser has them for
        // the redirect target. Setting on cookieStore here doesn't reach the
        // response object, so we set on both — cookieStore for any downstream
        // reader in this handler, response for the browser.
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            try { cookieStore.set(name, value, options); } catch { /* server component context */ }
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const dest = new URL(next, origin);
    dest.searchParams.set('auth_error', error.message);
    return NextResponse.redirect(dest);
  }

  return response;
}
