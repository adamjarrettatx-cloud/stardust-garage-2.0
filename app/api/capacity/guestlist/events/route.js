import { NextResponse } from 'next/server';
import { requireTeam } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { getTodayInAustin } from '@/lib/studio-helpers';
import { pickDefaultEventId, rosterWindowStart } from '@/lib/guestlist-checkin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/capacity/guestlist/events
//
// The event picker for the door kiosk: every event from yesterday onward that
// actually has a guest list, plus which one the kiosk should open on. The
// capacity counter has no notion of "the active event" (capacity_sessions is
// just a name and a max), so the door needs this instead of reusing it.
//
// Team-gated, then read with the service-role client — same posture as the
// Phase 4 guest list routes, and it keeps the join onto `contacts` working
// regardless of that table's RLS.
//
// Query params:
//   ?include_all=1  — skip the "has guest-list grants" filter. The door-
//                     session Start Event picker uses this so a manager can
//                     open a session for any upcoming event (early check-in,
//                     testing, or events that never had a guest list). The
//                     default guest-list dropdown does NOT pass this because
//                     an event with zero grants has nothing to work.
export async function GET(request) {
  const { unauthorized } = await requireTeam();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured in this environment.' }, { status: 500 });
  }

  const url = new URL(request.url);
  const includeAll = url.searchParams.get('include_all') === '1';

  const admin = createAdminClient();
  const today = getTodayInAustin();

  const { data: events, error: eventsError } = await admin
    .from('events')
    .select('id, title, event_date, event_time')
    .gte('event_date', rosterWindowStart(today))
    .order('event_date', { ascending: true })
    .limit(60);

  if (eventsError) {
    console.error('[door.guestlist.events]', eventsError);
    return NextResponse.json({ error: 'Could not load events' }, { status: 500 });
  }

  const eventIds = (events || []).map((e) => e.id);
  if (eventIds.length === 0) {
    return NextResponse.json({ ok: true, events: [], defaultEventId: null });
  }

  const { data: grants, error: grantsError } = await admin
    .from('event_guestlist_grants')
    .select('id, event_id')
    .in('event_id', eventIds);

  if (grantsError) {
    console.error('[door.guestlist.events.grants]', grantsError);
    return NextResponse.json({ error: 'Could not load guest lists' }, { status: 500 });
  }

  const eventIdByGrant = new Map((grants || []).map((g) => [g.id, g.event_id]));
  const grantIds = [...eventIdByGrant.keys()];

  let entries = [];
  if (grantIds.length > 0) {
    const { data, error } = await admin
      .from('event_guestlist_entries')
      .select('grant_id')
      .in('grant_id', grantIds);
    if (error) {
      console.error('[door.guestlist.events.entries]', error);
      return NextResponse.json({ error: 'Could not load guest lists' }, { status: 500 });
    }
    entries = data || [];
  }

  const entryCounts = new Map();
  for (const entry of entries) {
    const forEvent = eventIdByGrant.get(entry.grant_id);
    if (forEvent) entryCounts.set(forEvent, (entryCounts.get(forEvent) || 0) + 1);
  }

  // Only events someone has actually been granted slots on — an event with no
  // grant has no list to work, so it would just be noise in the picker.
  // include_all=1 opts out (door-session picker: every upcoming event is
  // valid to open a session on, guest list or not).
  const eventsWithGrants = new Set(eventIdByGrant.values());
  const shaped = (events || [])
    .filter((e) => includeAll || eventsWithGrants.has(e.id))
    .map((e) => ({
      id: e.id,
      title: e.title,
      event_date: e.event_date,
      event_time: e.event_time || null,
      entry_count: entryCounts.get(e.id) || 0,
    }));

  return NextResponse.json({
    ok: true,
    events: shaped,
    defaultEventId: pickDefaultEventId(shaped, today),
  });
}
