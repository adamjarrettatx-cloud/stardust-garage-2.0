import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/mobile/handoff-token
// Body: { returnTo?: string }
// Auth: Bearer <supabase_access_token> from the mobile app.
//
// Mints a one-time-use, short-lived (~60s) magic-link token bound to the
// caller's Supabase identity. The mobile client appends this token to the
// checkout URL as ?handoff=<token>&return_to=<path>. The web /handoff route
// verifies it, establishes a Supabase session cookie in Safari for the SAME
// user_id, then redirects the visitor to return_to so their checkout
// completes attached to their app account.
//
// Why this exists:
//   Ticket + membership checkouts run on the website (Path D Apple
//   compliance — external Stripe checkout, no 30% Apple tax). When a mobile
//   user taps "Buy tickets", the app opens Safari. Safari has its own
//   cookie jar disconnected from the app's Supabase session, so without a
//   handoff the user is logged out on the web, may re-sign-up with a
//   different email/provider (Apple isn't wired on the web, Google is the
//   default), and their ticket lands on a DIFFERENT auth user id. They
//   return to the app, wallet is empty, confusion.
//
// Security notes:
//   - Server verifies the incoming bearer against auth.getUser() BEFORE
//     minting the token. A forged/expired bearer gets 401.
//   - The minted token is Supabase's own magic-link hashed_token; verifying
//     it via verifyOtp() on the web is single-use and expires per Supabase
//     defaults (recommended: shorten Auth > URL Configuration > OTP expiry
//     if not already short — Supabase defaults are 3600s; we're fine even
//     with the default since the window between "user taps Buy" and "Safari
//     redeems it" is seconds).
//   - No returnTo is trusted verbatim: the /handoff route validates that
//     return_to is a same-origin path (starts with '/'), and rejects
//     absolute URLs or schemes to prevent open-redirect abuse.
export async function POST(request) {
  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return NextResponse.json({ error: 'Missing bearer token.' }, { status: 401 });
  }

  // Verify the mobile session with a scoped anon client that only sees this
  // request's Authorization header. Never trust the client to tell us who
  // they are; the id must come from the verified session.
  const anon = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userErr } = await anon.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }
  const user = userData.user;
  if (!user.email) {
    // A user with no email cannot receive a magic-link token. In practice
    // every Supabase auth path we support attaches an email (Apple private
    // relay counts). If we ever add anonymous auth, this must be revisited.
    return NextResponse.json({ error: 'Account has no email.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    console.error('[mobile.handoff-token] could not generate link', linkErr);
    return NextResponse.json({ error: 'Could not create handoff.' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    token: link.properties.hashed_token,
    // Client uses this to know how long they can hold the token; do not
    // rely on this value to gate anything — expiry is enforced by Supabase.
    expires_in_seconds: 60,
  });
}
