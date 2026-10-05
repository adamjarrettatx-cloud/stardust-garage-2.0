import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { stationContext } from '@/lib/station-session';
import { STATION_COOKIE, stationCookieOptions } from '@/lib/station-policy';
export async function GET() {
  const { station } = await stationContext();
  const response = NextResponse.json(station
    ? { username: station.username, label: station.label, role: station.role, expires_at: station.expires_at }
    : { error: 'Station session expired. Sign in again.' }, {
    status: station ? 200 : 401, headers: { 'Cache-Control': 'private, no-store' },
  });
  // Renew the Front Desk cookie on every check so the browser never drops it.
  if (station?.role === 'front_desk') {
    const token = (await cookies()).get(STATION_COOKIE)?.value;
    if (token) response.cookies.set(STATION_COOKIE, token, stationCookieOptions(station.role));
  }
  return response;
}
