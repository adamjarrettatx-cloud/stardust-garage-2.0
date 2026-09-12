import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createRequestScopedClient, requirePartner } from '@/lib/auth-helpers';
import {
  COMP_TYPE_OPTIONS,
  MAX_GUEST_NAME_LENGTH,
  MAX_GUEST_EMAIL_LENGTH,
  auditGuestlist,
  isValidGuestEmail,
  normalizeGuestEmail,
  normalizeGuestName,
} from '@/lib/guestlist-helpers';
import { sendGuestlistInvite } from '@/lib/email';
import { resolveSiteUrl } from '@/lib/site-url';

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
    // Pass `request` so the same handler serves both the web portal (session
    // cookies) and the mobile app (Authorization: Bearer <supabase jwt>).
    const { user, unauthorized } = await requirePartner(request);
    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const grantId = typeof body?.grantId === 'string' ? body.grantId : '';
    const compType = typeof body?.compType === 'string' ? body.compType : '';
    const guestName = normalizeGuestName(body?.guestName);
    const guestEmail = normalizeGuestEmail(body?.guestEmail);

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
    // Email is now required so we can send the guest an invite with a link
    // back to /g/<token>. Without it the guest has no way to finish signup
    // and the trial-pass / member-pass path never lights up for them.
    if (!guestEmail) {
      return NextResponse.json({ error: "Please enter your guest's email." }, { status: 400 });
    }
    if (guestEmail.length > MAX_GUEST_EMAIL_LENGTH || !isValidGuestEmail(guestEmail)) {
      return NextResponse.json({ error: "That email doesn't look right." }, { status: 400 });
    }
    if (!COMP_TYPES.includes(compType)) {
      return NextResponse.json({ error: 'Choose free or discounted entry.' }, { status: 400 });
    }

    // Bearer-scoped for mobile, cookie-scoped for web — either way the insert
    // below runs as the caller so RLS re-verifies partner_owns_grant().
    const supabase = await createRequestScopedClient(request);

    // Ownership is enforced by RLS on the insert below; this read is here to
    // tell the difference between "not yours" and "full", and to answer with
    // the right slot count in the message.
    //
    // We also pull the event fields the invite email needs (title, date, time,
    // discount detail) so the fire-and-forget send after insert doesn't need a
    // second round trip. RLS on event_guestlist_grants already lets a partner
    // read their own grant + the joined event, so this stays scoped to the
    // caller.
    const { data: grant } = await supabase
      .from('event_guestlist_grants')
      .select(
        'id, free_slots, discount_slots, discount_detail, event:events(title, event_date, event_time)'
      )
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
        guest_email: guestEmail,
        comp_type: compType,
        added_by: user.id,
      })
      // invite_token is stamped by the BEFORE INSERT trigger in
      // 20260912_guestlist_guest_email.sql; select it back so the client can
      // display or share the /g/<token> link without another round trip.
      .select('id, grant_id, guest_name, guest_email, invite_token, comp_type, status, created_at')
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

    // Fire-and-forget the guest invite email. Never block the API response on
    // Resend: the entry is already in the database, and an email retry story
    // belongs in a background job, not the promoter's Add-Guest button. If the
    // send fails we log it so we can spot deliverability drift, but the
    // promoter shouldn't see a red toast for something the door doesn't need.
    sendGuestInviteEmail({ request, entry, grant, compType }).catch((err) => {
      console.error('[partner guestlist] invite email send failed', {
        entry_id: entry.id,
        guest_email: entry.guest_email,
        error: err?.message || String(err),
      });
    });

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

// Building the invite URL + adder name has to survive missing pieces: the
// invite_token comes from a trigger (so a rare migration miss leaves it null),
// the joined event fields depend on the caller's RLS, and partner_self() is
// looked up via the admin client because RLS wouldn't let us read another
// partner row — but a partner reading their OWN name is safe and expected.
// If any single field is missing we still try to send with what we have; the
// template already handles null event/adder cases.
async function sendGuestInviteEmail({ request, entry, grant, compType }) {
  if (!entry?.invite_token || !entry?.guest_email) {
    console.warn('[partner guestlist] skipping invite email — missing token or email', {
      entry_id: entry?.id,
      has_token: Boolean(entry?.invite_token),
      has_email: Boolean(entry?.guest_email),
    });
    return;
  }

  const siteUrl = resolveSiteUrl(request);
  const inviteUrl = `${siteUrl}/g/${entry.invite_token}`;

  const event = grant?.event || {};
  const eventDate = formatEventDate(event.event_date);
  // events.event_time is stored as a free-form string ('9pm', '21:00', 'Doors
  // 8pm'). If it starts with HH:MM we normalize; otherwise pass through as-is.
  const eventTime = formatEventTime(event.event_time);

  // Best-effort adder name. entry.added_by is an auth.users id; the promoter's
  // display name lives on contacts via partner_profiles. Two-hop lookup, and
  // any failure just leaves the greeting generic ("You've been added…")
  // instead of "<Name> just added you…". Uses the admin client because RLS
  // on partner_profiles / contacts isn't scoped to serve this join.
  let addedByName = null;
  try {
    const admin = createAdminClient();
    if (entry.added_by) {
      const { data: adderProfile } = await admin
        .from('partner_profiles')
        .select('full_name, contact:contacts(display_name)')
        .eq('user_id', entry.added_by)
        .maybeSingle();
      addedByName =
        adderProfile?.contact?.display_name || adderProfile?.full_name || null;
    }
  } catch (err) {
    // Non-fatal — the template already handles a null adder.
    console.warn('[partner guestlist] could not look up adder name for invite email', err?.message);
  }

  await sendGuestlistInvite({
    email: entry.guest_email,
    guestName: entry.guest_name,
    eventTitle: event.title || null,
    eventDate,
    eventTime,
    compType,
    discountDetail: grant?.discount_detail || null,
    addedByName,
    inviteUrl,
  });
}

// Tiny formatters kept local so a single email send doesn't drag in a date
// library. The event_date column is a plain date; doors_time / start_time are
// times without zone. Both are stored as strings by PostgREST here.
function formatEventDate(value) {
  if (!value) return null;
  // event_date is 'YYYY-MM-DD'; construct as UTC to avoid the day-shift
  // that new Date('2026-09-12') can cause in negative-offset zones.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function formatEventTime(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  // If it starts with a HH:MM 24h clock, format it; otherwise pass through
  // the human-authored string ('Doors 8pm', 'Sunset').
  const m = /^(\d{1,2}):(\d{2})/.exec(raw);
  if (!m) return raw;
  let h = Number(m[1]);
  const min = m[2];
  if (h > 23) return raw;
  const suffix = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return min === '00' ? `${h}${suffix}` : `${h}:${min}${suffix}`;
}
