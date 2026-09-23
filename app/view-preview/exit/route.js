import { NextResponse } from 'next/server';
import { PREVIEW_COOKIE, viewConfig } from '@/lib/view-portal/config';
export const runtime = 'nodejs';
export async function POST() {
  let config;
  try { config = viewConfig(); } catch { return new NextResponse('Preview unavailable', { status: 503 }); }
  if (config.mode !== 'sandbox') return new NextResponse('Not found', { status: 404 });
  const response = NextResponse.redirect(`${config.controllerOrigin}/bananas/view-portal`, { status: 303 });
  response.cookies.set(PREVIEW_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return response;
}
