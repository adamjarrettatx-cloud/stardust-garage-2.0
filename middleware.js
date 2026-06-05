import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  const isAdminRoute  = pathname.startsWith('/admin');
  const isTeamRoute   = pathname === '/team' || pathname.startsWith('/team/');
  const isMemberRoute = pathname === '/member' || pathname.startsWith('/member/');

  if (!isAdminRoute && !isTeamRoute && !isMemberRoute) {
    return NextResponse.next();
  }

  // Allow login pages without auth
  if (pathname === '/admin/login' || pathname === '/login' || pathname === '/team/login') {
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

  // Not logged in -> bounce to appropriate login
  if (!user) {
    const url = request.nextUrl.clone();
    if (isAdminRoute) url.pathname = '/admin/login';
    else if (isTeamRoute) url.pathname = '/team/login';
    else url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  const isAdmin = Boolean(user.user_metadata?.is_admin);

  // Check team membership from team_members table
  let teamRole = null;
  if (!isAdmin) {
    const { data: tm } = await supabase
      .from('team_members')
      .select('role')
      .eq('user_id', user.id)
      .single();
    teamRole = tm?.role || null;
  }

  // /admin/* requires is_admin flag
  if (isAdminRoute && !isAdmin) {
    const url = request.nextUrl.clone();
    // Team members go to /team/calendar, others go to /member
    url.pathname = teamRole === 'team' ? '/team/calendar' : '/member';
    return NextResponse.redirect(url);
  }

  // /team/* requires team role (or admin)
  if (isTeamRoute && !isAdmin && teamRole !== 'team') {
    const url = request.nextUrl.clone();
    url.pathname = '/team/login';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
