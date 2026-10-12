import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase/admin';
import { PREVIEW_COOKIE, PREVIEW_DURATION, viewConfig } from '@/lib/view-portal/config';
import { personaEmail, viewPersona } from '@/lib/view-portal/personas';
import { signViewToken, verifyViewToken } from '@/lib/view-portal/tokens';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  let config;
  try { config = viewConfig(); } catch { return new NextResponse('Preview unavailable', { status: 503 }); }
  if (config.mode !== 'sandbox' || new URL(request.url).origin !== config.sandboxOrigin) {
    return new NextResponse('Preview unavailable', { status: 404 });
  }
  const form = await request.formData().catch(() => null);
  const launch = await verifyViewToken(form?.get('token'), config.secret, {
    purpose: 'launch', audience: config.sandboxOrigin, ownerId: config.ownerId, maxAge: 60,
  });
  const persona = viewPersona(launch?.persona);
  if (!launch || !persona) return new NextResponse('This preview link is invalid or expired.', { status: 403 });

  const admin = createAdminClient();
  // Unique nonce is the single-use guarantee. A replay fails before a session
  // is created, including if two requests arrive concurrently.
  const { error: nonceError } = await admin.from('view_portal_redemptions').insert({
    nonce: launch.jti, owner_id: launch.owner, persona_id: persona.id,
  });
  if (nonceError) return new NextResponse('This preview link has already been used.', { status: 409 });
  const { data: fixture, error: fixtureError } = await admin
    .from('view_portal_personas').select('user_id, ready').eq('persona_id', persona.id).maybeSingle();
  if (fixtureError || !fixture?.ready) return new NextResponse('This preview profile is not ready.', { status: 503 });

  const email = personaEmail(persona.id);
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (linkError || !link?.properties?.hashed_token) return new NextResponse('Could not start preview.', { status: 503 });

  const response = NextResponse.redirect(new URL(persona.path, config.sandboxOrigin), { status: 303 });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { cookies: {
      getAll: () => [],
      setAll: (values) => values.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
    } },
  );
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: link.properties.hashed_token, type: 'magiclink',
  });
  if (error || data.user?.id !== fixture.user_id) return new NextResponse('Could not verify preview identity.', { status: 503 });
  const now = Math.floor(Date.now() / 1000);
  response.cookies.set(PREVIEW_COOKIE, await signViewToken({
    purpose: 'session', aud: config.sandboxOrigin, owner: config.ownerId,
    persona: persona.id, user: fixture.user_id, jti: crypto.randomUUID(),
    iat: now, exp: now + PREVIEW_DURATION,
  }, config.secret), {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: PREVIEW_DURATION,
  });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'same-origin');
  return response;
}

export function GET() {
  return new NextResponse('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
}
