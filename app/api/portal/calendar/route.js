import { NextResponse } from 'next/server';
import { createRequestScopedClient, requirePartner } from '@/lib/auth-helpers';
import { profileCapabilities } from '@/lib/profile-capabilities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/portal/calendar
// The Programmer's 12-month venue calendar plus their own pitches. Bearer-aware
// so the mobile app can reuse it. partner_programming_calendar() returns
// titles only for public listings; every other occupied date is 'unavailable'.
export async function GET(request) {
  const { partner, unauthorized } = await requirePartner(request);
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!profileCapabilities(partner?.contact_type).calendar) {
    return NextResponse.json({ error: 'The calendar is not available for this profile.' }, { status: 403 });
  }
  const supabase = await createRequestScopedClient(request);
  const [calendar, pitches] = await Promise.all([
    supabase.rpc('partner_programming_calendar'),
    supabase.rpc('partner_my_pitches'),
  ]);
  if (calendar.error) {
    console.error('[portal calendar]', calendar.error.message);
    return NextResponse.json({ error: 'The calendar could not be loaded.' }, { status: 500 });
  }
  return NextResponse.json(
    { days: calendar.data || [], pitches: pitches.data || [] },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
