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

  if (!isAdminRoute && !isTeamRoute && !isMemberRoute && !isCapacityRoute) {
    return NextResponse.next();
  }

  // Allow login pages without auth
  if (pathname === '/bananas/login' || pathname === '/login' || pathname === '/team/login') {
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
