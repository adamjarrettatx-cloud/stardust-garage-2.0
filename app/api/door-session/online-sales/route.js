import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireFrontDeskOrTeam } from '@/lib/auth-helpers';
import { getActiveDoorSession } from '@/lib/door-session';
import { getOnlineSalesForEvent } from '@/lib/door-online-sales';

// GET /api/door-session/online-sales
//
// Online ticket count for the event the open door session is running, shown
// beside "Event running" on /capacity/front-desk. Always resolves the event
// from the open session server-side so a door account cannot read sales for
// an arbitrary event. Counts only -- no buyer or money data leaves here.
//
// Response:
//   { sales: null }   (no open session)
//   { sales: { event_id, source, sold, sold_scanned, comps, comps_scanned, as_of } }

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { unauthorized } = await requireFrontDeskOrTeam(request);
  if (unauthorized) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const session = await getActiveDoorSession(admin);
  if (!session?.event_id) return NextResponse.json({ sales: null });

  try {
    const sales = await getOnlineSalesForEvent(admin, session.event_id);
    if (!sales) return NextResponse.json({ sales: null });
    return NextResponse.json({ sales: { event_id: session.event_id, ...sales } });
  } catch {
    return NextResponse.json({ error: 'Could not load online sales.' }, { status: 500 });
  }
}
