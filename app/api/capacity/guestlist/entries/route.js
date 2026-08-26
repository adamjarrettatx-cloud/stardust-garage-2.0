import { NextResponse } from 'next/server';
import { requireTeam } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/capacity/guestlist/entries?eventId=<uuid>
//
// The whole roster for one event — every partner's names in one list, because
// door staff have to find whoever is in front of them without first knowing who
// put them on. The kiosk loads this once per event and filters as-you-type
// locally (see filterRoster), so typing a name never waits on the network.
//
// Each row carries the grant's discount_detail so the check-in screen can show
// staff what to ring up in the POS; there is no discount integration, the text
// IS the instruction.
export async function GET(request) {
  const { unauthorized } = await requireTeam();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const eventId = new URL(request.url).searchParams.get('eventId');
  if (!eventId || !UUID.test(eventId)) {
    return NextResponse.json({ error: 'A valid eventId is required.' }, { status: 400 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured in this environment.' }, { status: 500 });
  }

  const admin = createAdminClient();

  const { data: grants, error: grantsError } = await admin
    .from('event_guestlist_grants')
    .select('id, contact_id, discount_detail')
    .eq('event_id', eventId);

  if (grantsError) {
    console.error('[door.guestlist.entries.grants]', grantsError);
    return NextResponse.json({ error: 'Could not load the guest list' }, { status: 500 });
  }

  if (!grants || grants.length === 0) {
    return NextResponse.json({ ok: true, entries: [] });
  }

  const contactIds = [...new Set(grants.map((g) => g.contact_id).filter(Boolean))];
  let namesByContact = new Map();
  if (contactIds.length > 0) {
    const { data: contacts } = await admin
      .from('contacts')
      .select('id, display_name')
      .in('id', contactIds);
    namesByContact = new Map((contacts || []).map((c) => [c.id, c.display_name]));
  }

  const grantById = new Map(grants.map((g) => [g.id, g]));

  const { data: entries, error: entriesError } = await admin
    .from('event_guestlist_entries')
    .select('id, grant_id, guest_name, comp_type, status, checked_in_at, guest_profile_id')
    .in('grant_id', [...grantById.keys()]);

  if (entriesError) {
    console.error('[door.guestlist.entries.list]', entriesError);
    return NextResponse.json({ error: 'Could not load the guest list' }, { status: 500 });
  }

  const shaped = (entries || []).map((entry) => {
    const grant = grantById.get(entry.grant_id);
    return {
      id: entry.id,
      grant_id: entry.grant_id,
      guest_name: entry.guest_name,
      comp_type: entry.comp_type,
      status: entry.status,
      checked_in_at: entry.checked_in_at,
      guest_profile_id: entry.guest_profile_id,
      // Who put them on the list — the disambiguator when two partners both
      // added a "Chris".
      partner_name: namesByContact.get(grant?.contact_id) || 'Unknown host',
      discount_detail: grant?.discount_detail || null,
    };
  });

  return NextResponse.json({ ok: true, entries: shaped });
}
