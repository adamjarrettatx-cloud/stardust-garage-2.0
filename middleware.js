import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Only run auth logic on /admin/* and /member/* routes
  const isAdminRoute = pathname.startsWith('/admin');
const isMemberRoute = pathname === '/member' || pathname.startsWith('/member/');
  if (!isAdminRoute && !isMemberRoute) {
    return NextResponse.next();
  }

  // Allow login pages to be accessed without auth
  if (pathname === '/admin/login' || pathname === '/login') {
    return NextResponse.next();
  }

  // Dev safety: if Supabase isn't configured, skip auth so the UI is
  // browsable for layout work.
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

  // Not logged in -> bounce to the appropriate login page
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = isAdminRoute ? '/admin/login' : '/login';
    return NextResponse.redirect(url);
  }

  const isAdmin = Boolean(user.user_metadata?.is_admin);

  // Trying to hit /admin/* without admin flag -> send them to /member
  if (isAdminRoute && !isAdmin) {
    const url = request.nextUrl.clone();
    url.pathname = '/member';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
