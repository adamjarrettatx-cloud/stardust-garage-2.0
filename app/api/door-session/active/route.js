import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireTeam } from '@/lib/auth-helpers';
import { getActiveDoorSession } from '@/lib/door-session';

// GET /api/door-session/active
//
// Returns the currently-open door session (if any), enriched with the
// event's title and event_date so the /scan header can render without
// a second round trip.
//
// Response:
//   { session: null }
//   { session: { id, event_id, opened_at, opened_by, notes,
//                event: { id, title, event_date } } }

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { unauthorized } = await requireTeam();
  if (unauthorized) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const session = await getActiveDoorSession(admin);
  if (!session) return NextResponse.json({ session: null });

  const { data: event } = await admin
    .from('events')
    .select('id, title, event_date')
    .eq('id', session.event_id)
    .maybeSingle();

  return NextResponse.json({
    session: {
      ...session,
      event: event || null,
    },
  });
}
