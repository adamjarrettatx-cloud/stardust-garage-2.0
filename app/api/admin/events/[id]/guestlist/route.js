import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildGrantPayload, loadEventGrants, auditGuestlist } from '@/lib/guestlist-helpers';
import { notifyGrantPartner } from '@/lib/guestlist-notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// Guest list allocations for one event. Writes go through this route rather than
// the client Supabase session so validation and the guestlist_audit_log row are
// server-side and unskippable — same reasoning as
// /api/admin/events/:id/tt-link.

// GET — every grant on this event with its usage counts and the contact's
// partner-login state.
export async function GET(_request, { params }) {
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();
  const { grants, error } = await loadEventGrants(admin, id);
  if (error) {
    console.error('[event.guestlist.list]', error);
    return NextResponse.json({ error: 'Could not load guest list grants' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, grants });
}

// POST — grant a contact an allocation for this event.
// Body: { contactId, total_slots, free_slots, discount_slots, discount_detail?, notes? }
export async function POST(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

  const contactId = body?.contactId;
  if (typeof contactId !== 'string' || !UUID.test(contactId)) {
    return NextResponse.json({ error: 'Select a contact to grant slots to.' }, { status: 400 });
  }

  const { valid, error: validationError, data: payload } = buildGrantPayload(body);
  if (!valid) return NextResponse.json({ error: validationError }, { status: 400 });

  const admin = createAdminClient();

  const { data: event } = await admin.from('events').select('id').eq('id', id).maybeSingle();
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  const { data: contact } = await admin
    .from('contacts')
    .select('id, display_name')
    .eq('id', contactId)
    .maybeSingle();
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

  // granted_by is a team_members id, matching how the rest of /bananas records
  // which staff member did something (see potential_members.added_by).
  const { data: callerTeamMember } = await admin
    .from('team_members')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();

  const { data: created, error: insertError } = await admin
    .from('event_guestlist_grants')
    .insert({
      event_id: id,
      contact_id: contactId,
      granted_by: callerTeamMember?.id || null,
      ...payload,
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('[event.guestlist.create]', insertError);
    // One allocation row per contact per event — editing the existing grant is
    // the intended path, so say so instead of surfacing a constraint name.
    if (insertError.code === '23505') {
      return NextResponse.json(
        { error: `${contact.display_name} already has a grant for this event — edit it instead.` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Could not create the grant' }, { status: 500 });
  }

  await auditGuestlist({
    admin,
    action: 'grant_created',
    grantId: created.id,
    actorId: user.id,
    actorEmail: user.email,
    request,
    details: {
      // Also in the grant_id column, but that goes null if the grant is later
      // revoked (ON DELETE SET NULL), so keep a copy the history can be read by.
      grant_id: created.id,
      event_id: id,
      contact_id: contactId,
      contact_name: contact.display_name,
      ...payload,
    },
  });

  // Best-effort, after the audit row: the allocation exists whatever the mail
  // server does. `notification` tells the panel whether the partner was told.
  const notification = await notifyGrantPartner({
    admin,
    request,
    eventId: id,
    contactId,
    slots: payload,
  });

  const { grants } = await loadEventGrants(admin, id);
  return NextResponse.json({ ok: true, grants: grants || null, notification }, { status: 201 });
}
