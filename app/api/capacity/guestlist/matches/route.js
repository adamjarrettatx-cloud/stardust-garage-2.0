import { NextResponse } from 'next/server';
import { requireTeam } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import {
  escapeLikePattern,
  maskGuestProfile,
  matchModeFor,
  normalizeGuestName,
} from '@/lib/guestlist-checkin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CANDIDATES = 8;

// GET /api/capacity/guestlist/matches?entryId=<uuid>
//
// "Have we met this person before?" — asked when staff tap a name, not when the
// roster loads, so a full list of attendees' masked phone numbers is never sent
// to the tablet just to render a list.
//
// Matching is an exact case-insensitive full_name comparison against
// guest_profiles (that column has a lower(full_name) index for exactly this).
// Fuzzy matching is deliberately NOT used: a false positive here means waving in
// the wrong person under someone else's contact record, which is worse than
// asking a returning guest for their phone number a second time.
export async function GET(request) {
  const { unauthorized } = await requireTeam();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const entryId = new URL(request.url).searchParams.get('entryId');
  if (!entryId || !UUID.test(entryId)) {
    return NextResponse.json({ error: 'A valid entryId is required.' }, { status: 400 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured in this environment.' }, { status: 500 });
  }

  const admin = createAdminClient();

  const { data: entry, error: entryError } = await admin
    .from('event_guestlist_entries')
    .select('id, guest_name, status, guest_profile_id')
    .eq('id', entryId)
    .maybeSingle();

  if (entryError) {
    console.error('[door.guestlist.matches.entry]', entryError);
    return NextResponse.json({ error: 'Could not load the guest' }, { status: 500 });
  }
  if (!entry) {
    return NextResponse.json({ error: 'Guest not found' }, { status: 404 });
  }

  const profileSelect =
    'id, full_name, phone, email, marketing_consent, created_at, first_seen_event:first_seen_event_id ( title, event_date )';

  // Already linked (a previous check-in, or an earlier tap on this same entry):
  // that link is more trustworthy than any name search, so it wins outright.
  let linked = null;
  if (entry.guest_profile_id) {
    const { data } = await admin
      .from('guest_profiles')
      .select(profileSelect)
      .eq('id', entry.guest_profile_id)
      .maybeSingle();
    linked = maskGuestProfile(data);
  }

  let candidates = [];
  if (!linked) {
    const name = normalizeGuestName(entry.guest_name);
    if (name) {
      const { data, error } = await admin
        .from('guest_profiles')
        .select(profileSelect)
        .ilike('full_name', escapeLikePattern(name))
        .order('created_at', { ascending: true })
        .limit(MAX_CANDIDATES);
      if (error) {
        console.error('[door.guestlist.matches.profiles]', error);
        return NextResponse.json({ error: 'Could not check for a returning guest' }, { status: 500 });
      }
      candidates = (data || []).map(maskGuestProfile);
    }
  }

  return NextResponse.json({
    ok: true,
    entry: { id: entry.id, guest_name: entry.guest_name, status: entry.status },
    linked,
    candidates,
    mode: matchModeFor(candidates, linked),
  });
}
