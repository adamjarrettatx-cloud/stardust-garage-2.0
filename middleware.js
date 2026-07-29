import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  const isAdminRoute  = pathname.startsWith('/bananas');
  const isTeamRoute   = pathname === '/team' || pathname.startsWith('/team/');
  const isMemberRoute = pathname === '/member' || pathname.startsWith('/member/');
  // Capacity counter pages (the two Jelly2 door devices) are staff-only. The
  // /capacity/admin sub-route additionally requires admin (re-checked on the
  // page via requireAdmin); here we enforce at least the team gate.
  const isCapacityRoute = pathname === '/capacity' || pathname.startsWith('/capacity/');
  // Partner pages (promoters/collectives/vendors managing their guest list) are
  // gated on partner_profiles.is_active, not on team_members at all.
  const isPartnerRoute = pathname === '/partner' || pathname.startsWith('/partner/');

  if (!isAdminRoute && !isTeamRoute && !isMemberRoute && !isCapacityRoute && !isPartnerRoute) {
    return NextResponse.next();
  }

  // Allow login pages without auth
  if (pathname === '/bananas/login' || pathname === '/login' || pathname === '/team/login') {
    return NextResponse.next();
  }

  // Three partner routes are reachable logged out, for the same underlying
  // reason: they are how a partner GETS a session, so gating them on one would
  // bounce every arrival to /login.
  //
  //   /partner/activate    — the invite email lands here carrying the
  //     magic-link tokens in the URL *fragment*, which the server never sees.
  //     The page waits for the browser client to exchange it, then resolves the
  //     invite via /api/partner/resolve-identity and offers the sign-in buttons
  //     if the link was already used.
  //   /partner/login       — where a returning partner signs in. Partners have
  //     no password, so the unified /login is no use to them.
  //   /partner/auth/callback — where Google returns after OAuth. The session
  //     does not exist until this route exchanges the code, and the route does
  //     its own gating: an account with no matching invite is signed straight
  //     back out.
  //
  // Same relaxation shape as the door-device pages below.
  if (
    pathname === '/partner/activate' ||
    pathname === '/partner/login' ||
    pathname === '/partner/auth/callback'
  ) {
    return NextResponse.next();
  }

  // Door-device pages (the two Jelly2 stations) may be opened with a device
  // token instead of a team session — see Phase 1.1 device tokens. When a
  // ?token= is present we let the request through WITHOUT the team gate; the
  // page itself verifies the token server-side via /api/capacity/device/* and
  // shows "Device not authorized" if it is missing/invalid/revoked. This is the
  // ONLY auth relaxation here and is scoped strictly to the two door pages — it
  // does NOT loosen the team/admin gate anywhere else (including /capacity and
  // /capacity/admin). A logged-in team member can still open these pages too.
  const isDoorPage =
    pathname === '/capacity/front-door' || pathname === '/capacity/exit-door';
  if (isDoorPage && request.nextUrl.searchParams.has('token')) {
    return NextResponse.next();
  }

  // Dev safety: skip auth if Supabase isn't configured
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Not logged in -> bounce to the unified login, with a next= param so the
  // login page can send them back to where they were headed after sign-in.
  if (!user) {
    const url = request.nextUrl.clone();
    const originalPath = pathname + (request.nextUrl.search || '');
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', originalPath);
    return NextResponse.redirect(url);
  }

  // SECURITY: Source of truth for admin status is the server-controlled
  // `team_members` table, NOT `user_metadata` (which is end-user editable per
  // Supabase advisor 0015). We still tolerate legacy metadata = true so we
  // don't lock out existing admins during the rollout, but the new
  // /admin/documents pages and API routes re-check via team_members in
  // getCurrentUser() / requireAdmin().
  const { data: tm } = await supabase
    .from('team_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  const teamRole = tm?.role || null;
  const isAdmin = teamRole === 'admin' || Boolean(user.user_metadata?.is_admin);

  // Partner status is only needed for the mutual-exclusion checks below, and
  // staff can never be partners, so skip the extra round trip for them. The
  // select-own-row policy on partner_profiles is what makes this readable with
  // the anon key.
  let isActivePartner = false;
  if (!isAdmin && teamRole !== 'team') {
    const { data: partner } = await supabase
      .from('partner_profiles')
      .select('is_active')
      .eq('user_id', user.id)
      .maybeSingle();
    isActivePartner = Boolean(partner?.is_active);
  }

  // Partners are not staff and not members: keep them out of every other
  // authenticated area rather than letting them land on an empty /member
  // dashboard.
  if (isActivePartner && !isPartnerRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/partner';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // /partner/* requires an ACTIVE partner profile. Everyone else — including
  // admins, team and members — goes to the public home page, the mirror image
  // of the rule above.
  if (isPartnerRoute && !isActivePartner) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // /admin/* requires is_admin flag
  if (isAdminRoute && !isAdmin) {
    const url = request.nextUrl.clone();
    // Team members go to /team/calendar, others go to /member
    url.pathname = teamRole === 'team' ? '/team/calendar' : '/member';
    return NextResponse.redirect(url);
  }

  // /team/* requires team role (or admin). Already authenticated with the
  // wrong role -> straight to /member, same pattern as the admin branch above
  // (no need to route back through the login page).
  if (isTeamRoute && !isAdmin && teamRole !== 'team') {
    const url = request.nextUrl.clone();
    url.pathname = '/member';
    return NextResponse.redirect(url);
  }

  // /capacity/* requires team role (or admin). The page-level requireAdmin()
  // further restricts /capacity/admin.
  if (isCapacityRoute && !isAdmin && teamRole !== 'team') {
    const url = request.nextUrl.clone();
    url.pathname = '/member';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
