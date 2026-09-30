import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { STATION_COOKIE, hashStationToken, sameOrigin } from '@/lib/station-policy';
export async function POST(request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  const token = (await cookies()).get(STATION_COOKIE)?.value;
  if (token) {
    try {
      const { error } = await createAdminClient().rpc('close_station_session', { p_hash: await hashStationToken(token) });
      if (error) throw error;
    } catch {
      return NextResponse.json({ error: 'Could not revoke this session. Retry, or ask the owner to disable the station.' }, { status: 503 });
    }
  }
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  response.cookies.set(STATION_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 0 });
  return response;
}
