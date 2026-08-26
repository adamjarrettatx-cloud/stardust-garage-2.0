import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { findPartnerByInvitedEmail, relinkPartnerToUser } from '@/lib/partner-identity';

export const runtime = 'nodejs';

// GET /portal/auth/callback?code=...
//
// Where Google drops the partner after OAuth. Exchanges the PKCE code for a
// session, decides whether that Google account is actually an invited partner,
// and sends them on to activation or their profile.
//
// This is the only Supabase auth callback in the app: the member/team/admin
// login is password-based and the partner magic link carries its tokens in the
// URL fragment, which the browser client picks up on /portal/activate without
// ever hitting the server. So there is no existing route to mirror — the shape
// below is the canonical @supabase/ssr code-exchange handler.
//
// SECURITY: an invite is the only way to become a partner. A Google account we
// don't recognise gets signed straight back out rather than left holding a
// session, and no partner_profiles row is ever created here.

function loginRedirect(origin, params) {
  const url = new URL('/portal/login', origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return NextResponse.redirect(url);
}

export async function GET(request) {
  const requestUrl = new URL(request.url);
  // Vercel terminates TLS upstream, so request.url carries the internal host.
  // x-forwarded-host is what the browser actually asked for, and the redirect
  // has to land back on that origin or the session cookie won't be readable.
  // Trusting that header is safe here because Vercel overwrites any
  // client-supplied value at the edge, and every redirect below is to a fixed
  // first-party path — nothing user-supplied reaches the path or the host.
  const forwardedHost = request.headers.get('x-forwarded-host');
  const origin = forwardedHost
    ? `${request.headers.get('x-forwarded-proto') || 'https'}://${forwardedHost}`
    : requestUrl.origin;

  const code = requestUrl.searchParams.get('code');

  if (!code) {
    // No code means consent was refused or cancelled, or the provider bounced
    // us. Google/Supabase describe it in error_description; the partner just
    // gets "try again", so that detail stays in the log.
    console.error(
      '[partner/auth/callback] no code returned',
      requestUrl.searchParams.get('error_description') || requestUrl.searchParams.get('error')
    );
    return loginRedirect(origin, { error: 'oauth_failed' });
  }

  const supabase = await createClient();
  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  const user = data?.user || null;
  if (exchangeError || !user?.email) {
    console.error('[partner/auth/callback] code exchange failed', exchangeError);
    return loginRedirect(origin, { error: 'oauth_failed' });
  }

  const admin = createAdminClient();
  const profile = await findPartnerByInvitedEmail(admin, user.email);

  if (!profile) {
    // Authenticated, but not one of ours. Drop the session rather than leaving
    // a stranger signed in to the site with no role — middleware would bounce
    // them off every gated page anyway, and a dangling session reads as "it
    // sort of worked".
    await supabase.auth.signOut();
    return loginRedirect(origin, { error: 'no_invite', email: user.email });
  }

  // The invite pre-created an auth user for this email; Google may or may not
  // have been linked to it. Whichever identity is holding the session now
  // becomes the one the profile belongs to.
  const { error: relinkError } = await relinkPartnerToUser({
    admin,
    profile,
    userId: user.id,
    userEmail: user.email,
    request,
  });

  if (relinkError) {
    // user_id is unique: this Google account is already the partner login for
    // a different contact. Signing them in anyway would resolve their guest
    // list to the wrong organization.
    await supabase.auth.signOut();
    return loginRedirect(origin, { error: 'link_conflict', email: user.email });
  }

  // Google sign-in is an entry point into activation, not a way around it —
  // an unactivated partner still owes us the name and photo door staff match
  // against before is_active flips.
  const destination = profile.is_active ? '/portal/profile' : '/portal/activate';
  return NextResponse.redirect(new URL(destination, origin));
}
