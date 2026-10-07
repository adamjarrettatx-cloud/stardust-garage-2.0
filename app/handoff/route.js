import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { safeMobileReturnPath } from '@/lib/mobile-return-path';
import { openHandoff } from '@/lib/mobile-handoff-token.mjs';
import { META_APP_OPTOUT_COOKIE, META_APP_OPTOUT_MAX_AGE } from '@/lib/meta/policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /handoff?token=<hashed_token>&return_to=<same-origin-path>
//
// Redeemed by the browser (Safari) after the mobile app opens Safari to a
// checkout URL that first passes through this route. Verifies the one-time
// magic-link token minted by /api/mobile/handoff-token, which causes
// @supabase/ssr to write the session cookies onto this Safari session for
// the SAME user_id that is signed into the mobile app. Then 302s to
// return_to so the buyer lands on the checkout page already signed in.
//
// The mobile app never sends the user's password or full session to the
// web — only the one-time hashed token, which is single-use and short-lived.
//
// Failure modes are all handled by redirecting to /login?next=<return_to>
// so the visitor can still buy the ticket, they just have to sign in
// themselves. Better to fall back gracefully than to hard-fail the
// checkout flow entirely.
export async function GET(request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  const rawReturnTo = url.searchParams.get('return_to') || '/';

  // Only accept same-origin paths. Reject schemes, protocol-relative URLs,
  // and anything that starts with something other than a single '/' — this
  // is the standard open-redirect guard. A malicious link like
  // /handoff?token=X&return_to=https://evil.example.com must not redirect
  // the visitor off-domain.
  const returnTo = safeMobileReturnPath(rawReturnTo, url.origin);
  const returnAbsolute = new URL(returnTo, url.origin).toString();
  const loginFallback = new URL(`/login?next=${encodeURIComponent(returnTo)}`, url.origin).toString();

  function fallback() {
    const response = NextResponse.redirect(loginFallback, { status: 302 });
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  }
  const handoff = openHandoff(token, process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!handoff || (handoff.returnTo !== null && handoff.returnTo !== returnTo)) return fallback();

  // Prepare a response so createServerClient can attach Set-Cookie headers
  // onto it. We WILL replace this with a redirect below; the cookies survive
  // because we forward them onto the redirect response.
  const response = NextResponse.redirect(returnAbsolute, { status: 302 });
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: handoff.tokenHash,
    type: 'magiclink',
  });

  if (error || data?.user?.id !== handoff.userId) {
    // Discard the cookie-bearing response if identity validation failed.
    return fallback();
  }

  // Visitors who arrive from the mobile app are never measured by Meta on the
  // web (browser pixel or server events). See lib/meta/policy.js.
  response.cookies.set(META_APP_OPTOUT_COOKIE, '1', {
    path: '/',
    maxAge: META_APP_OPTOUT_MAX_AGE,
    sameSite: 'lax',
    secure: true,
    httpOnly: false, // the browser pixel reads it
  });

  // Session cookies are on `response`; the 302 to returnAbsolute carries
  // them and Safari stores them. Subsequent requests on sdgatx.com will
  // see the visitor as the same user_id that's signed into the app.
  return response;
}
