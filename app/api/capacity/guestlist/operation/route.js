import { NextResponse } from 'next/server';
import { requireTeam } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { auditGuestlist } from '@/lib/guestlist-helpers';
import {
  DOOR_OPERATIONS,
  isDoorOperation,
  normalizeGuestName,
  validateGuestIntake,
} from '@/lib/guestlist-checkin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/capacity/guestlist/operation
// Body: { op: 'check_in' | 'no_show', entryId, guestProfileId?, newGuest? }
//
// Single entry point for both door writes, mirroring /api/capacity/operation.
// Everything the door changes goes through here rather than a client Supabase
// call so the guestlist_audit_log row is written on the same path as the update
// and cannot be skipped by a tablet with a stale bundle.
//
// check_in resolves the guest identity one of two ways:
//   * guestProfileId — staff confirmed an existing guest_profiles match.
//   * newGuest       — first time we've met them: phone + email + consent are
//                      required and a new guest_profiles row is created.
export async function POST(request) {
  const { user, unauthorized } = await requireTeam();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const op = body?.op;
  if (!isDoorOperation(op)) {
    return NextResponse.json({ error: 'Unknown operation' }, { status: 400 });
  }

  const entryId = body?.entryId;
  if (typeof entryId !== 'string' || !UUID.test(entryId)) {
    return NextResponse.json({ error: 'A valid entryId is required.' }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured in this environment.' }, { status: 500 });
  }

  const admin = createAdminClient();

  const { data: entry, error: entryError } = await admin
    .from('event_guestlist_entries')
    .select('id, grant_id, guest_name, comp_type, status, guest_profile_id, checked_in_at')
    .eq('id', entryId)
    .maybeSingle();

  if (entryError) {
    console.error('[door.guestlist.operation.entry]', entryError);
    return NextResponse.json({ error: 'Could not load the guest' }, { status: 500 });
  }
  if (!entry) {
    return NextResponse.json({ error: 'Guest not found' }, { status: 404 });
  }
  if (entry.status !== 'pending') {
    return NextResponse.json(
      { error: alreadyResolvedMessage(entry), code: 'already_resolved' },
      { status: 409 },
    );
  }

  const { data: grant } = await admin
    .from('event_guestlist_grants')
    .select('id, event_id, contact_id, discount_detail')
    .eq('id', entry.grant_id)
    .maybeSingle();

  // checked_in_by is a team_members id, matching granted_by / added_by elsewhere
  // in the guest list rather than the raw auth uid.
  const { data: staff } = await admin
    .from('team_members')
    .select('id, full_name')
    .eq('user_id', user.id)
    .maybeSingle();

  const updates = { status: DOOR_OPERATIONS[op].status };
  let createdProfile = null;

  if (op === 'check_in') {
    const resolved = await resolveGuestProfile({ admin, entry, grant, body });
    if (resolved.error) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    createdProfile = resolved.created ? resolved.profile : null;
    updates.guest_profile_id = resolved.profile.id;
    updates.checked_in_at = new Date().toISOString();
    updates.checked_in_by = staff?.id || null;
  }

  // Conditional on status='pending': two tablets working the same line can tap
  // the same name at once, and the loser gets a clear 409 instead of silently
  // overwriting the first check-in's timestamp.
  const { data: updated, error: updateError } = await admin
    .from('event_guestlist_entries')
    .update(updates)
    .eq('id', entry.id)
    .eq('status', 'pending')
    .select('id, guest_name, comp_type, status, checked_in_at, guest_profile_id')
    .maybeSingle();

  if (updateError) {
    console.error('[door.guestlist.operation.update]', updateError);
    return NextResponse.json({ error: 'Could not update the guest' }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json(
      { error: 'Someone else just handled this guest — refresh the list.', code: 'already_resolved' },
      { status: 409 },
    );
  }

  await auditGuestlist({
    admin,
    action: DOOR_OPERATIONS[op].auditAction,
    grantId: entry.grant_id,
    entryId: entry.id,
    actorId: user.id,
    actorEmail: user.email,
    request,
    details: {
      // 'no_show' is not a value of the guestlist_audit_log.action CHECK
      // constraint, so it rides along as a reason on the entry_removed action.
      reason: op === 'no_show' ? 'no_show' : 'checked_in',
      source: 'door_kiosk',
      entry_id: entry.id,
      grant_id: entry.grant_id,
      event_id: grant?.event_id || null,
      guest_name: entry.guest_name,
      comp_type: entry.comp_type,
      guest_profile_id: updated.guest_profile_id,
      new_guest_profile: Boolean(createdProfile),
      checked_in_by: staff?.id || null,
      checked_in_by_name: staff?.full_name || user.email || null,
    },
  });

  return NextResponse.json({ ok: true, entry: updated });
}

// Returns { profile } for the guest_profiles row this check-in should link to,
// creating it when the guest is new. Returns { error, status } instead when the
// request cannot be honoured.
async function resolveGuestProfile({ admin, entry, grant, body }) {
  const guestProfileId = body?.guestProfileId;

  if (guestProfileId !== undefined && guestProfileId !== null) {
    if (typeof guestProfileId !== 'string' || !UUID.test(guestProfileId)) {
      return { error: 'A valid guestProfileId is required.', status: 400 };
    }
    const { data: profile } = await admin
      .from('guest_profiles')
      .select('id')
      .eq('id', guestProfileId)
      .maybeSingle();
    if (!profile) {
      return { error: 'That guest record no longer exists — collect their details again.', status: 404 };
    }
    return { profile, created: false };
  }

  const { valid, error, data } = validateGuestIntake(body?.newGuest);
  if (!valid) {
    return { error, status: 400 };
  }

  // The name on the list is the name that goes on the permanent record: it is
  // what the next door shift will search for.
  const { data: created, error: insertError } = await admin
    .from('guest_profiles')
    .insert({
      full_name: normalizeGuestName(entry.guest_name),
      phone: data.phone,
      email: data.email,
      marketing_consent: data.marketing_consent,
      first_seen_event_id: grant?.event_id || null,
    })
    .select('id, full_name')
    .single();

  if (insertError) {
    console.error('[door.guestlist.operation.profile]', insertError);
    return { error: 'Could not save the guest details', status: 500 };
  }
  return { profile: created, created: true };
}

function alreadyResolvedMessage(entry) {
  if (entry.status === 'no_show') return `${entry.guest_name} is already marked as a no-show.`;
  const at = entry.checked_in_at
    ? new Date(entry.checked_in_at).toLocaleTimeString('en-US', {
        timeZone: 'America/Chicago',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;
  return at
    ? `${entry.guest_name} was already checked in at ${at}.`
    : `${entry.guest_name} is already checked in.`;
}
