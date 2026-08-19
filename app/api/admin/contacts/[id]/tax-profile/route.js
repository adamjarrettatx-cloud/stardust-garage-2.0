import { NextResponse } from 'next/server';
import { requireTeam, requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { auditContact } from '@/lib/contact-helpers';

export const runtime = 'nodejs';

const VALID_ENTITY_TYPES = new Set(['individual', 'llc', 'other']);

// GET /api/admin/contacts/:id/tax-profile
//
// Team-readable (they need to see W9 status while booking an artist) even
// though only admins may write it — same split as the RLS policies on
// contact_tax_profiles itself.
export async function GET(request, { params }) {
  const { unauthorized } = await requireTeam();
  if (unauthorized) {
    return NextResponse.json({ error: 'Team access required.' }, { status: 401 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('contact_tax_profiles')
    .select('id, contact_id, entity_type, w9_on_file, w9_document_id, w9_received_at, notes, updated_at')
    .eq('contact_id', id)
    .maybeSingle();

  if (error) {
    console.error('[tax-profile.get] error', error);
    return NextResponse.json({ error: 'Failed to load tax profile.' }, { status: 500 });
  }

  return NextResponse.json({ taxProfile: data || null });
}

// PATCH /api/admin/contacts/:id/tax-profile
// Body: { entity_type?, w9_on_file?, w9_document_id?, notes? }
//
// Admin-only (MFA-gated, same bar as invite-partner) — this is the only write
// path; contact_tax_profiles has no client-writable RLS policy at all. Upserts
// on contact_id so the first save creates the row and later edits update it.
// w9_document_id is expected to already point at a document the caller just
// uploaded through the existing /api/admin/documents endpoint (category
// "tax") — this route only ever links to it, it never touches storage itself.
export async function PATCH(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  if (body.entity_type !== undefined && !VALID_ENTITY_TYPES.has(body.entity_type)) {
    return NextResponse.json({ error: 'Invalid entity_type.' }, { status: 400 });
  }
  if (body.w9_document_id !== undefined && body.w9_document_id !== null && !/^[0-9a-f-]{36}$/i.test(body.w9_document_id)) {
    return NextResponse.json({ error: 'Invalid w9_document_id.' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: contact } = await admin.from('contacts').select('id, display_name').eq('id', id).maybeSingle();
  if (!contact) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });

  // If a new document is being attached, verify it actually exists before we
  // link it — a bad id here would otherwise fail silently at read time.
  if (body.w9_document_id) {
    const { data: doc } = await admin.from('documents').select('id').eq('id', body.w9_document_id).maybeSingle();
    if (!doc) return NextResponse.json({ error: 'That document was not found.' }, { status: 400 });
  }

  const patch = { contact_id: id, updated_by: user.id };
  if (body.entity_type !== undefined) patch.entity_type = body.entity_type;
  if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes).slice(0, 2000) : null;
  if (body.w9_document_id !== undefined) {
    patch.w9_document_id = body.w9_document_id || null;
    // Attaching a document is what actually flips "on file" — a manual
    // on_file=true with no document would be a claim we can't back up.
    if (body.w9_document_id) {
      patch.w9_on_file = true;
      patch.w9_received_at = new Date().toISOString();
    }
  }
  if (body.w9_on_file === false) {
    patch.w9_on_file = false;
  }

  const { data: existing } = await admin
    .from('contact_tax_profiles')
    .select('id')
    .eq('contact_id', id)
    .maybeSingle();
  if (!existing) patch.created_by = user.id;

  const { data: saved, error: upsertErr } = await admin
    .from('contact_tax_profiles')
    .upsert(patch, { onConflict: 'contact_id' })
    .select('id, contact_id, entity_type, w9_on_file, w9_document_id, w9_received_at, notes, updated_at')
    .single();

  if (upsertErr) {
    console.error('[tax-profile.patch] upsert error', upsertErr);
    return NextResponse.json({ error: 'Failed to save tax profile.' }, { status: 500 });
  }

  await auditContact({
    admin,
    action: 'update',
    contactId: id,
    actorId: user.id,
    actorEmail: user.email,
    request,
    details: {
      note: 'Tax profile updated',
      entity_type: saved.entity_type,
      w9_on_file: saved.w9_on_file,
    },
  });

  return NextResponse.json({ ok: true, taxProfile: saved });
}
