import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePartner } from '@/lib/auth-helpers';
import {
  COMP_TYPE_OPTIONS,
  MAX_GUEST_NAME_LENGTH,
  auditGuestlist,
  normalizeGuestName,
} from '@/lib/guestlist-helpers';

export const runtime = 'nodejs';

// SQLSTATE raised by event_guestlist_entries_enforce_capacity() when the insert
// would overflow the allocation. Defined in 20260731_partner_guestlist_portal.sql.
const CAPACITY_EXCEEDED = 'GL409';

const COMP_TYPES = COMP_TYPE_OPTIONS.map((o) => o.value);

// POST /api/portal/guestlist/entries
// Body: { grantId: uuid, guestName: string, compType: 'free' | 'discount' }
//
// Adds one named guest to one of the calling partner's allocations.
//
// WHY THIS ROUTE EXISTS AT ALL, given RLS already lets a partner insert into
// event_guestlist_entries directly: the policy checks partner_owns_grant() and
// nothing else. It cannot count how many names are already on the list, so it
// cannot stop a five-slot allocation from collecting fifty. The cap is enforced
// by a BEFORE INSERT trigger that locks the grant row (see the migration for
// why the check has to be in the database rather than here), and this route
// exists to attach the audit trail and turn the trigger's exception into a
// message a promoter can act on.
//
// The insert itself deliberately goes through the CALLER'S session, not the
// service-role client: RLS re-checks partner_owns_grant(grant_id) on the way
// in, so a partner who posts somebody else's grantId is refused by the database
// even if the check below were wrong. The service-role client is used for the
// audit row only, because guestlist_audit_log is team-insert-only by design.
export async function POST(request) {
  try {
    const { user, unauthorized } = await requirePartner();
    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const grantId = typeof body?.grantId === 'string' ? body.grantId : '';
    const compType = typeof body?.compType === 'string' ? body.compType : '';
    const guestName = normalizeGuestName(body?.guestName);

    if (!grantId) {
      return NextResponse.json({ error: 'Which guest list is this for?' }, { status: 400 });
    }
    if (!guestName) {
      return NextResponse.json({ error: "Please enter your guest's name." }, { status: 400 });
    }
    if (guestName.length > MAX_GUEST_NAME_LENGTH) {
      return NextResponse.json(
        { error: `Names can be up to ${MAX_GUEST_NAME_LENGTH} characters.` },
        { status: 400 }
      );
    }
    if (!COMP_TYPES.includes(compType)) {
      return NextResponse.json({ error: 'Choose free or discounted entry.' }, { status: 400 });
    }

    const supabase = await createClient();

    // Ownership is enforced by RLS on the insert below; this read is here to
    // tell the difference between "not yours" and "full", and to answer with
    // the right slot count in the message.
    const { data: grant } = await supabase
      .from('event_guestlist_grants')
      .select('id, free_slots, discount_slots')
      .eq('id', grantId)
      .maybeSingle();

    if (!grant) {
      return NextResponse.json({ error: 'Guest list not found.' }, { status: 404 });
    }

    const allowed = compType === 'free' ? grant.free_slots : grant.discount_slots;
    if (!allowed) {
      return NextResponse.json(
        { error: `You have no ${compType === 'free' ? 'free' : 'discounted'} spots on this event.` },
        { status: 409 }
      );
    }

    const { data: entry, error: insertError } = await supabase
      .from('event_guestlist_entries')
      .insert({
        grant_id: grantId,
        guest_name: guestName,
        comp_type: compType,
        added_by: user.id,
      })
      .select('id, grant_id, guest_name, comp_type, status, created_at')
      .single();

    if (insertError) {
      // The trigger fired: somebody filled the last spot between the partner
      // loading the page and tapping Add. Not an error on their part, so say
      // what happened rather than "something went wrong".
      if (insertError.code === CAPACITY_EXCEEDED) {
        return NextResponse.json(
          {
            error: `All ${allowed} ${compType === 'free' ? 'free' : 'discounted'} spots on this event are used.`,
            code: 'capacity_exceeded',
          },
          { status: 409 }
        );
      }
      console.error('[partner guestlist] entry insert failed', insertError);
      return NextResponse.json({ error: 'Could not add that guest.' }, { status: 400 });
    }

    await auditEntryAdded({ user, request, entry, grantId, guestName, compType });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    console.error('[partner guestlist] add entry route error', err);
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}

// Split out so a failure to build the service-role client (missing env in a
// preview deploy) cannot lose an entry the database already accepted.
// auditGuestlist() itself never throws; createAdminClient() does.
async function auditEntryAdded({ user, request, entry, grantId, guestName, compType }) {
  try {
    await auditGuestlist({
      admin: createAdminClient(),
      action: 'entry_added',
      grantId,
      entryId: entry.id,
      actorId: user.id,
      actorEmail: user.email,
      request,
      details: { grant_id: grantId, guest_name: guestName, comp_type: compType },
    });
  } catch (err) {
    console.error('[partner guestlist] could not write entry_added audit row', err);
  }
}
