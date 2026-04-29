import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

// =====================================================================
// PRIVATE MODE: When true, the entire public site is hidden.
// Only the root "/" page (the early member signup) and /admin routes
// are accessible.
//
// To launch the full site: change PRIVATE_MODE to false (or delete this
// whole block of logic at the top of middleware).
// =====================================================================
const PRIVATE_MODE = true;

// Routes that are always allowed (admin, API routes, Next.js internals,
// and the root early-signup page itself)
function isAllowedDuringPrivateMode(pathname) {
  if (pathname === '/') return true;
  if (pathname.startsWith('/admin')) return true;
  if (pathname.startsWith('/api')) return true;
  if (pathname.startsWith('/_next')) return true;
  if (pathname.startsWith('/favicon')) return true;
  if (pathname.startsWith('/fonts')) return true;
  return false;
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith('/admin')) {
    return NextResponse.next();
  }

  // Allow /admin/login to be accessed without auth
  if (pathname === '/admin/login') {
    return NextResponse.next();
  }

  // Dev mode: if Supabase env vars aren't configured, skip auth so the
  // admin UI is browsable for layout work. Real deployments must set these.
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

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  // ====================================================================
  // ADMIN AUTH GATE: protect /admin routes (but allow /admin/login)
  // ====================================================================
  if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
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

    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin/login';
      return NextResponse.redirect(url);
    }

    return supabaseResponse;
  }

  return NextResponse.next();
}

export const config = {
  // Run middleware on all routes EXCEPT static assets
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
