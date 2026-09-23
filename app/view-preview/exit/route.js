import { NextResponse } from 'next/server';
import { PREVIEW_COOKIE, PREVIEW_PROJECT_REF, viewConfig } from '@/lib/view-portal/config';
export const runtime = 'nodejs';
export async function POST(request) {
  let config;
  try { config = viewConfig(); } catch { return new NextResponse('Preview unavailable', { status: 503 }); }
  if (config.mode !== 'sandbox') return new NextResponse('Not found', { status: 404 });
  if (new URL(request.url).origin !== config.sandboxOrigin
    || request.headers.get('origin') !== config.sandboxOrigin) {
    return new NextResponse('Invalid preview origin', { status: 403 });
  }
  const response = NextResponse.redirect(`${config.controllerOrigin}/bananas/view-portal`, { status: 303 });
  const expired = { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 };
  response.cookies.set(PREVIEW_COOKIE, '', expired);
  const authPrefix = `sb-${PREVIEW_PROJECT_REF}-auth-token`;
  for (const raw of (request.headers.get('cookie') || '').split(';')) {
    const name = raw.trim().split('=')[0];
    if (name === authPrefix || name.startsWith(`${authPrefix}.`)) {
      response.cookies.set(name, '', expired);
    }
  }
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
