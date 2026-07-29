import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  buildGrantPayload,
  countGrantUsage,
  grantRevokeBlockedMessage,
  grantSlotsIncreased,
  loadEventGrants,
  auditGuestlist,
} from '@/lib/guestlist-helpers';
import { notifyGrantPartner } from '@/lib/guestlist-notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

const GRANT_SELECT = `
  id, event_id, contact_id, total_slots, free_slots, discount_slots, discount_detail, notes,
  contact:contact_id ( display_name ),
  entries:event_guestlist_entries ( id, comp_type, status )
`;

// Loads the grant and confirms it belongs to the event in the URL, so a grant id
// from another event can't be edited through this path.
async function loadGrant(admin, eventId, grantId) {
  const { data } = await admin
    .from('event_guestlist_grants')
    .select(GRANT_SELECT)
    .eq('id', grantId)
    .eq('event_id', eventId)
    .maybeSingle();
  return data || null;
}

function gate(id, grantId) {
  if (!UUID.test(id) || !UUID.test(grantId)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  return null;
}

// PATCH — change an existing allocation's slot numbers, discount detail or notes.
export async function PATCH(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });

  const { id, grantId } = await params;
  const bad = gate(id, grantId);
  if (bad) return bad;

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

  const admin = createAdminClient();
  const grant = await loadGrant(admin, id, grantId);
  if (!grant) return NextResponse.json({ error: 'Grant not found' }, { status: 404 });

  const usage = countGrantUsage(grant.entries);
  const { valid, error: validationError, data: payload } = buildGrantPayload(body, usage);
  if (!valid) return NextResponse.json({ error: validationError }, { status: 400 });

  const { error: updateError } = await admin
    .from('event_guestlist_grants')
    .update(payload)
    .eq('id', grantId);

  if (updateError) {
    console.error('[event.guestlist.update]', updateError);
    return NextResponse.json({ error: 'Could not update the grant' }, { status: 500 });
  }

  const before = {
    total_slots: grant.total_slots,
    free_slots: grant.free_slots,
    discount_slots: grant.discount_slots,
    discount_detail: grant.discount_detail,
    notes: grant.notes,
  };

  await auditGuestlist({
    admin,
    action: 'grant_updated',
    grantId,
    actorId: user.id,
    actorEmail: user.email,
    request,
    details: {
      // Duplicated from the grant_id column, which goes null if the grant is
      // later revoked (ON DELETE SET NULL) — see the DELETE handler below.
      grant_id: grantId,
      event_id: id,
      contact_id: grant.contact_id,
      contact_name: grant.contact?.display_name || null,
      usage,
      before,
      after: payload,
    },
  });

  // Only a bigger allocation is worth an email — a shrink, or an edit that only
  // touched the notes, is not news to the partner. Best-effort, same contract as
  // the create route.
  const notification = grantSlotsIncreased(before, payload)
    ? await notifyGrantPartner({
        admin,
        request,
        eventId: id,
        contactId: grant.contact_id,
        slots: payload,
        isUpdate: true,
      })
    : { sent: false, reason: 'slots_not_increased', error: null };

  const { grants } = await loadEventGrants(admin, id);
  return NextResponse.json({ ok: true, grants: grants || null, notification });
}

// DELETE — revoke an allocation outright. Only allowed while no guest still
// occupies a slot; the audit row carries the whole grant because the row itself
// is about to disappear.
export async function DELETE(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });

  const { id, grantId } = await params;
  const bad = gate(id, grantId);
  if (bad) return bad;

  const admin = createAdminClient();
  const grant = await loadGrant(admin, id, grantId);
  if (!grant) return NextResponse.json({ error: 'Grant not found' }, { status: 404 });

  const usage = countGrantUsage(grant.entries);
  const blocked = grantRevokeBlockedMessage(usage);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });

  const { error: deleteError } = await admin
    .from('event_guestlist_grants')
    .delete()
    .eq('id', grantId);

  if (deleteError) {
    console.error('[event.guestlist.revoke]', deleteError);
    return NextResponse.json({ error: 'Could not revoke the grant' }, { status: 500 });
  }

  // Audited after the delete so a failed delete can't leave a grant_revoked row
  // behind for a grant that still exists. The grant_id COLUMN has to be null —
  // the row it pointed at is gone, and the FK would reject it — so the id rides
  // in details instead, which is also what keeps this grant's earlier
  // grant_created/grant_updated rows (nulled by ON DELETE SET NULL) joinable.
  await auditGuestlist({
    admin,
    action: 'grant_revoked',
    actorId: user.id,
    actorEmail: user.email,
    request,
    details: {
      grant_id: grantId,
      event_id: id,
      contact_id: grant.contact_id,
      contact_name: grant.contact?.display_name || null,
      revoked_grant: {
        total_slots: grant.total_slots,
        free_slots: grant.free_slots,
        discount_slots: grant.discount_slots,
        discount_detail: grant.discount_detail,
        notes: grant.notes,
      },
      no_show_entries: (grant.entries || []).length,
    },
  });

  const { grants } = await loadEventGrants(admin, id);
  return NextResponse.json({ ok: true, grants: grants || null });
}
