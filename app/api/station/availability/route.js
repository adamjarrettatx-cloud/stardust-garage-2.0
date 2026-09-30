import { NextResponse } from 'next/server';
import { stationContext } from '@/lib/station-session';
import { createAdminClient } from '@/lib/supabase/admin';
import { availabilityDays } from '@/lib/calendar-availability';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'Vary': 'Cookie' };
export async function GET() {
  try {
    const { station } = await stationContext();
    if (!station) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers });
    if (station.role !== 'calendar_availability') return NextResponse.json({ error: 'Not authorized.' }, { status: 403, headers });
    const { data, error } = await createAdminClient().rpc('station_calendar_availability', { p_hash: station.sessionHash });
    if (error) throw new Error('Availability unavailable');
    return NextResponse.json({ days: availabilityDays(data), timezone: 'America/Chicago' }, { headers });
  } catch {
    return NextResponse.json({ error: 'Availability could not be verified. Please retry.' }, { status: 503, headers });
  }
}
