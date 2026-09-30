import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { STATION_COOKIE, STATION_SESSION_SECONDS, hashStationToken, normalizeStationUsername, sameOrigin, stationHome } from '@/lib/station-policy';

export const runtime = 'nodejs';
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function POST(request) {
  if (!sameOrigin(request)) return reply({ error: 'Invalid request origin.' }, 403);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return reply({ error: 'Invalid login.' }, 400);
    body = JSON.parse(raw);
  } catch { return reply({ error: 'Invalid login.' }, 400); }
  const username = normalizeStationUsername(body?.username);
  const password = body?.password;
  if (!username || typeof password !== 'string' || password.length < 1 || password.length > 128) {
    return reply({ error: 'Invalid username or password.' }, 401);
  }
  try {
    const admin = createAdminClient();
    // Username and global limits remain authoritative even if a proxy/IP
    // header is spoofed. No raw username or IP is stored in limiter buckets.
    const ip = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'unknown';
    for (const [key, limit] of [['global', 200], [`ip:${ip}`, 60], [`user:${username}`, 10]]) {
      const { data, error } = await admin.rpc('consume_station_login_limit', {
        p_bucket: await hashStationToken(key), p_limit: limit, p_seconds: 900,
      });
      if (error) return reply({ error: 'Sign-in is temporarily unavailable.' }, 503);
      if (!data) {
        const response = reply({ error: 'Too many sign-in attempts. Try again in 15 minutes.' }, 429);
        response.headers.set('Retry-After', '900');
        return response;
      }
    }
    const { data: station, error } = await admin.from('station_accounts')
      .select('id,user_id,auth_email,epoch,role,active,reset_started_at').eq('username', username).maybeSingle();
    if (error) return reply({ error: 'Sign-in is temporarily unavailable.' }, 503);
    // Unknown/disabled usernames still use the same provider password path.
    const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error: authError } = await auth.auth.signInWithPassword({
      email: station?.auth_email || `${randomUUID()}@station.sdgatx.invalid`, password,
    });
    // Discard and revoke provider refresh tokens. They are never cookies,
    // database fields, response JSON, logs, or browser storage.
    if (data?.session?.access_token) {
      const { error: revokeError } = await admin.auth.admin.signOut(data.session.access_token, 'global');
      if (revokeError) return reply({ error: 'Sign-in is temporarily unavailable.' }, 503);
    }
    if (authError || !station?.active || station.reset_started_at || data?.user?.id !== station.user_id) {
      return reply({ error: 'Invalid username or password.' }, 401);
    }
    const token = randomBytes(32).toString('base64url');
    const { data: opened, error: openError } = await admin.rpc('open_station_session', {
      p_station: station.id, p_epoch: station.epoch, p_hash: await hashStationToken(token),
    });
    if (openError || !opened) return reply({ error: 'Sign-in is temporarily unavailable. Try again.' }, 503);
    const old = request.cookies?.get(STATION_COOKIE)?.value;
    if (old) await admin.rpc('close_station_session', { p_hash: await hashStationToken(old) });
    const response = reply({ destination: stationHome(station.role) });
    // Never leave an owner's personal Supabase session underneath a station
    // login on a shared machine. Removing the station cookie must not restore it.
    for (const cookie of request.cookies?.getAll?.() || []) {
      if (cookie.name.startsWith('sb-')) response.cookies.set(cookie.name, '', { path: '/', maxAge: 0 });
    }
    response.cookies.set(STATION_COOKIE, token, {
      httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: STATION_SESSION_SECONDS,
    });
    return response;
  } catch { return reply({ error: 'Sign-in is temporarily unavailable.' }, 503); }
}
