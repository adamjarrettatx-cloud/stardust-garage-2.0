import { NextResponse } from 'next/server';
import { stationContext } from '@/lib/station-session';
export async function GET() {
  const { station } = await stationContext();
  return NextResponse.json(station
    ? { username: station.username, label: station.label, role: station.role, expires_at: station.expires_at }
    : { error: 'Station session expired. Sign in again.' }, {
    status: station ? 200 : 401, headers: { 'Cache-Control': 'private, no-store' },
  });
}
