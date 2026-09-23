import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { teamDocumentPath } from '@/lib/document-access';
import { partnerRouteRedirect } from '@/lib/partner-access';

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  const isAdminRoute  = pathname.startsWith('/bananas');
  const isTeamRoute   = pathname === '/team' || pathname.startsWith('/team/');
  const isMemberRoute = pathname === '/member' || pathname.startsWith('/member/');
  // Capacity counter pages (the two Jelly2 door devices) are staff-only. The
  // /capacity/admin sub-route additionally requires admin (re-checked on the
  // page via requireAdmin); here we enforce at least the team gate.
  const isCapacityRoute = pathname === '/capacity' || pathname.startsWith('/capacity/');
  // Portal pages (DJs, collectives, promoters, vendors, etc. managing their
  // guest list or requesting pay) are gated on partner_profiles.is_active, not
  // on team_members at all. Called "partner" internally (see partner_profiles);
  // "portal" is the user-facing name.
  const isPartnerRoute = pathname === '/portal' || pathname.startsWith('/portal/');
  // /account/* (Stardust-account surface for ticket buyers) is auth-gated by
  // its own layout, but middleware still needs to run here so that
  // @supabase/ssr can REFRESH the session cookies. Server Components can't
  // call Set-Cookie (lib/supabase/server.js's setAll silently swallows the
  // error), so if the middleware doesn't touch cookies for this path, a
  // rotated access token during the SSR render never reaches the browser and
  // the next request looks logged-out — which bounces the visitor to /login
  // out of the blue. See the setAll comment in lib/supabase/server.js.
  const isAccountRoute = pathname === '/account' || pathname.startsWith('/account/');
  // /events/* also needs the middleware cookie-refresh dance even though
  // it's publicly viewable, because InternalTicketModal on those pages
  // calls supabase.auth.getUser() from the client to decide whether to
  // show the AccountGate. If the access-token cookie went stale between
  // page loads and the middleware never touched cookies for /events, the
  // client's getUser() returns null and a signed-in buyer sees "Sign in
  // to buy tickets" out of nowhere. Same treatment as /account: run
  // through the createServerClient block below purely so @supabase/ssr
  // can write refreshed cookies, then early-return before any gating.
  const isEventsRoute = pathname === '/events' || pathname.startsWith('/events/');

  if (!isAdminRoute && !isTeamRoute && !isMemberRoute && !isCapacityRoute && !isPartnerRoute && !isAccountRoute && !isEventsRoute) {
    return NextResponse.next();
  }

  // Allow login pages without auth
  if (pathname === '/bananas/login' || pathname === '/login' || pathname === '/team/login') {
    return NextResponse.next();
  }

  // Three portal routes are reachable logged out, for the same underlying
  // reason: they are how a portal user GETS a session, so gating them on one
  // would bounce every arrival to /login.
  //
  //   /portal/activate    — the invite email lands here carrying a single-use
  //     ?token_hash=, which the browser client redeems for a session. The page
  //     waits for that, then resolves the invite via
  //     /api/portal/resolve-identity and offers the sign-in buttons if the
  //     link was already used.
  //   /portal/login       — where a returning portal user signs in. They have
  //     no password, so the unified /login is no use to them.
  //   /portal/auth/callback — where Google returns after OAuth. The session
  //     does not exist until this route exchanges the code, and the route does
  //     its own gating: an account with no matching invite is signed straight
  //     back out.
  //
  // Same relaxation shape as the door-device pages below.
  if (
    pathname === '/portal/activate' ||
    pathname === '/portal/login' ||
    pathname === '/portal/auth/callback'
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

  // /account/* is gated by its own layout redirect; middleware runs here
  // ONLY to give @supabase/ssr a request in which it is legal to write
  // refreshed session cookies. We deliberately do NOT do our own bounce for
  // this path — an unauthenticated visitor is fine here (the layout will
  // redirect them, with a proper `next=` for the specific subpath), and role
  // checks below (admin/team/partner) are meaningless for ticket buyers.
  if (isAccountRoute || isEventsRoute) {
    // Both routes are publicly viewable \u2014 middleware ran only to refresh
    // the auth cookie for the client-side supabase.auth.getUser() call
    // that the ticket modal (and /account layout) does. No gating here.
    return supabaseResponse;
  }

  // Not logged in -> bounce to the unified login, with a next= param so the
  // login page can send them back to where they were headed after sign-in.
  //
  // Except under /portal/*: that login is password-based and portal users
  // never get a password, so sending them there is a dead end. They go to the
  // Google / magic-link page instead.
  if (!user) {
    const url = request.nextUrl.clone();
    const originalPath = pathname + (request.nextUrl.search || '');
    url.pathname = isPartnerRoute ? '/portal/login' : '/login';
    url.search = '';
    if (!isPartnerRoute) url.searchParams.set('next', originalPath);
    return NextResponse.redirect(url);
  }

  // SECURITY: Source of truth for admin status is the server-controlled
  // `team_members` table, NOT end-user-editable `user_metadata`.
  const { data: tm } = await supabase
    .from('team_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  const teamRole = tm?.role || null;
  const isAdmin = teamRole === 'admin';
  // calendar_viewer is a hard-locked read-only role (see
  // 20260918_calendar_viewer_role.sql). They are ALLOWED on /team/calendar
  // and NOWHERE else that this middleware guards. Do this check before every
  // other role branch below so they can never fall through into /portal,
  // /member, /bananas, or the rest of /team/*.
  const isCalendarViewer = teamRole === 'calendar_viewer';
  if (isCalendarViewer) {
    if (pathname === '/team/calendar') {
      return supabaseResponse;
    }
    const url = request.nextUrl.clone();
    url.pathname = '/team/calendar';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // front_desk is a hard-locked, single-purpose role (see
  // 20260919_front_desk_role.sql) for the venue's attended-entry laptop.
  // Every front-of-house staffer who works the door has their OWN
  // front_desk login so that trial passes, guest check-ins, and capacity
  // +1/-1 events are attributed to the specific human on shift. The role
  // is ALLOWED on /capacity/front-desk and NOWHERE else this middleware
  // guards — not the door kiosks, not the scan page, not the tablet
  // guest-list, not /capacity/admin, and none of /bananas, /team/*,
  // /member/*, /portal/*. Same shape as the calendar_viewer branch above.
  const isFrontDesk = teamRole === 'front_desk';
  if (isFrontDesk) {
    if (pathname === '/capacity/front-desk') {
      return supabaseResponse;
    }
    const url = request.nextUrl.clone();
    url.pathname = '/capacity/front-desk';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Partner access is additive, not a replacement for membership or staff.
  // Only read it on portal routes; ordinary account/member gates stay intact.
  if (isPartnerRoute) {
    const { data: partner } = await supabase
      .from('partner_profiles')
      .select('is_active, activated_at')
      .eq('user_id', user.id)
      .maybeSingle();
    const destination = partnerRouteRedirect({ pathname, partner, teamRole });
    if (destination) {
      const url = request.nextUrl.clone();
      url.pathname = destination;
      url.search = '';
      return NextResponse.redirect(url);
    }
  }

  // /admin/* requires is_admin flag
  if (isAdminRoute && !isAdmin) {
    const url = request.nextUrl.clone();
    if (teamRole === 'team') {
      // SOPs live in the admin document hub, but they are staff reading
      // material — a team member following an SOP link used to land on the
      // calendar with no explanation. Send them to the read-only team viewer
      // for the same document instead. teamDocumentPath() returns null for
      // everything else under /bananas (contracts, templates, the field
      // editor), which keeps the original calendar fallback.
      url.pathname = teamDocumentPath(pathname) || '/team/calendar';
    } else {
      url.pathname = '/member';
    }
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
