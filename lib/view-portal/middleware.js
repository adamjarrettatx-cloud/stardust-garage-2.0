import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { PREVIEW_COOKIE, PREVIEW_DURATION, PREVIEW_PROJECT_REF, viewConfig } from './config';
import { viewPersona } from './personas';
import { verifyViewToken } from './tokens';

function locked(message = 'Open a new preview from your owner View Portal.', status = 403) {
  return new NextResponse(message, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}
export async function previewRequestGate(request) {
  if (process.env.VIEW_PORTAL_MODE !== 'sandbox') return { active: false };
  let config;
  try { config = viewConfig(); } catch { return { active: true, denied: locked('Preview environment is locked.', 503) }; }
  if (request.nextUrl.origin !== config.sandboxOrigin) return { active: true, denied: locked('Wrong preview hostname.') };
  const path = request.nextUrl.pathname;
  if (path === '/view-preview/redeem' || path === '/view-preview/exit') return { active: true, config, cookies: [] };
  // No cron, webhook, sign-in handoff or owner-launch endpoint may bypass the lease.
  if (/^\/api\/(cron|webhooks?)(\/|$)/.test(path)
    || path === '/api/admin/view-portal/launch') return { active: true, denied: locked('Unavailable in preview.') };
  const lease = await verifyViewToken(request.cookies.get(PREVIEW_COOKIE)?.value, config.secret, {
    purpose: 'session', audience: config.sandboxOrigin, ownerId: config.ownerId, maxAge: PREVIEW_DURATION,
  });
  if (!lease || !viewPersona(lease.persona) || !lease.user) return { active: true, denied: locked() };
  const refreshedCookies = [];
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => values.forEach((cookie) => {
        request.cookies.set(cookie.name, cookie.value); refreshedCookies.push(cookie);
      }),
    },
  });
  const bearer = request.headers.get('authorization');
  const { data, error } = await client.auth.getUser(bearer?.startsWith('Bearer ') ? bearer.slice(7) : undefined);
  if (error || data.user?.id !== lease.user) return { active: true, denied: locked('Preview identity changed. Start a new preview.') };
  return { active: true, config, cookies: refreshedCookies };
}
export function previewResponse(response, context, request) {
  if (!context.active) return response;
  const { config } = context;
  const location = response.headers.get('location');
  if (location && config) {
    const target = new URL(location, config.sandboxOrigin);
    const exiting = request.nextUrl.pathname === '/view-preview/exit'
      && target.href === `${config.controllerOrigin}/bananas/view-portal`;
    if (target.origin !== config.sandboxOrigin && !exiting) response = locked('External redirects are disabled in preview.');
  }
  for (const { name, value, options } of context.cookies || []) response.cookies.set(name, value, options);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  response.headers.set('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: https://${PREVIEW_PROJECT_REF}.supabase.co`,
    `connect-src 'self' https://${PREVIEW_PROJECT_REF}.supabase.co wss://${PREVIEW_PROJECT_REF}.supabase.co`,
    "form-action 'self'", "frame-src 'none'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'",
  ].join('; '));
  return response;
}
