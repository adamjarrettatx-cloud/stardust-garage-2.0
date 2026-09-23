import { NextResponse } from 'next/server';
import { requireViewPortalOwner, launchConfig } from '@/lib/view-portal/owner';
import { viewPersona } from '@/lib/view-portal/personas';
import { signViewToken } from '@/lib/view-portal/tokens';
export const runtime = 'nodejs';

export async function POST(request) {
  const gate = await requireViewPortalOwner();
  if (gate.unauthorized) return NextResponse.json({ error: gate.reason }, { status: 403 });
  let config;
  try { config = launchConfig(); } catch {
    return NextResponse.json({ error: 'The isolated preview environment is not ready.' }, { status: 503 });
  }
  if (request.headers.get('origin') !== config.controllerOrigin) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const persona = viewPersona(body?.persona);
  if (!persona) return NextResponse.json({ error: 'Unknown view' }, { status: 400 });
  const now = Math.floor(Date.now() / 1000);
  const token = await signViewToken({
    purpose: 'launch', aud: config.sandboxOrigin, owner: gate.user.id,
    persona: persona.id, jti: crypto.randomUUID(), iat: now, exp: now + 60,
  }, config.secret);
  return NextResponse.json({
    action: `${config.sandboxOrigin}/view-preview/redeem`, token,
  }, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
