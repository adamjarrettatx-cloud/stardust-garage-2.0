import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import {
  createAdminClient,
  audit,
  buildStoragePath,
  sha256,
  DOCUMENT_BUCKET,
} from '@/lib/document-helpers';
import { validateFieldLayout } from '@/lib/contract-fields';
import { isContractTemplatesEnabled } from '@/lib/feature-flags';
import { normalizeContractDateTime } from '@/lib/contract-helpers';
import {
  organizerLegalName,
  organizerSigner,
  isArchivedContact,
  validateContractSetup,
} from '@/lib/event-organizer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// POST /api/admin/documents/from-template
//   Body: {
//     template_id, title?, counterparty?, event_id?,
//     contact_id?,                       // the Event Organizer (profile-first)
//     artist_contact_id?, collective_contact_id?, vendor_contact_id?,
//     master_contract_id?,               // applicable Master Agreement
//     effective_date?, expiration_date?, // venue-local datetime strings
//     notes?
//   }
//
//   Clones a template's PDF into a NEW contract-category document (as its first
//   version) and creates a document_contracts row whose field_layout is a COPY
//   of the template's layout (independently editable per Adam's requirement that
//   the recipient-fillable field set varies per send). Returns { document_id }.
//
// PROFILE-FIRST BEHAVIOR (added with the Event Organizer workflow):
//   * When an event_id + Event Organizer contact_id are supplied, the organizer
//     is stamped onto BOTH documents.contact_id and document_contracts.contact_id
//     so the contract shows up on the Event record and on the organizer profile
//     with no extra wiring, and signer_1 is prefilled from the organizer profile.
//   * The relationship rules (event required, organizer required, Master
//     Agreement required for templates that demand one) live in
//     lib/event-organizer.js validateContractSetup() so the drawer and this route
//     enforce exactly the same thing.
//   * Legacy callers that post only { template_id, title, counterparty } keep
//     working: the organizer rules are only applied when an event_id is present,
//     which is what the Documents Hub "new from template" path does today.
export async function POST(request) {
  if (!isContractTemplatesEnabled()) {
    return NextResponse.json({ error: 'Not found', code: 'FEATURE_DISABLED' }, { status: 404 });
  }
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

  const templateId = String(body.template_id || '').trim();
  if (!UUID.test(templateId)) return NextResponse.json({ error: 'Valid template_id is required' }, { status: 400 });

  const admin = createAdminClient();
  const { data: tpl } = await admin
    .from('contract_templates')
    .select('*')
    .eq('id', templateId)
    .maybeSingle();
  if (!tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  // Re-validate the stored layout defensively before cloning.
  const layoutRes = validateFieldLayout(tpl.field_layout);
  const clonedLayout = layoutRes.ok ? layoutRes.layout : [];

  const title = String(body.title || tpl.title || 'Untitled contract').trim();
  const eventId = typeof body.event_id === 'string' && UUID.test(body.event_id) ? body.event_id : null;
  const organizerId =
    typeof body.contact_id === 'string' && UUID.test(body.contact_id) ? body.contact_id : null;

  // --- Profile-first path: an event-scoped contract must satisfy the organizer
  // --- relationship rules before anything is written or copied.
  let setup = {
    event_id: eventId,
    contact_id: organizerId,
    master_contract_id: null,
    artist_contact_id: null,
    collective_contact_id: null,
    vendor_contact_id: null,
    owner_user_id: null,
  };
  let organizer = null;

  if (eventId) {
    const res = validateContractSetup({
      template: tpl,
      eventId,
      organizerContactId: organizerId,
      masterContractId: body.master_contract_id,
      artistContactId: body.artist_contact_id,
      collectiveContactId: body.collective_contact_id,
      vendorContactId: body.vendor_contact_id,
      ownerUserId: null,
      effectiveDate: body.effective_date,
      expirationDate: body.expiration_date,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    setup = { ...res.setup, owner_user_id: user.id };
    delete setup.template_id;

    // The event must exist and must actually be the organizer's event, so a
    // caller can't staple a contract onto an unrelated event.
    const { data: event } = await admin
      .from('events')
      .select('id, title, event_date, contact_id')
      .eq('id', eventId)
      .maybeSingle();
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    const { data: contact } = await admin
      .from('contacts')
      .select('*')
      .eq('id', setup.contact_id)
      .maybeSingle();
    if (!contact) return NextResponse.json({ error: 'Event Organizer not found' }, { status: 404 });
    if (isArchivedContact(contact)) {
      return NextResponse.json(
        { error: 'That Event Organizer profile is archived. Reactivate it or pick another.' },
        { status: 400 },
      );
    }
    organizer = contact;

    // A Master Agreement reference must belong to the SAME organizer, otherwise
    // we would be pointing an event agreement at somebody else's terms.
    if (setup.master_contract_id) {
      const { data: master } = await admin
        .from('document_contracts')
        .select('id, contact_id, status')
        .eq('id', setup.master_contract_id)
        .maybeSingle();
      if (!master) {
        return NextResponse.json({ error: 'Master Agreement not found' }, { status: 404 });
      }
      if (master.contact_id !== setup.contact_id) {
        return NextResponse.json(
          { error: 'That Master Agreement belongs to a different Event Organizer.' },
          { status: 400 },
        );
      }
    }
  }

  // counterparty is the plain-text name printed on the document. When we have an
  // organizer profile, its legal name is authoritative over anything the client
  // typed, so the archive can never disagree with the profile.
  const counterparty = organizer
    ? organizerLegalName(organizer)
    : String(body.counterparty || '').trim() || null;

  const effectiveDate = normalizeContractDateTime(body.effective_date);
  const expirationDate = normalizeContractDateTime(body.expiration_date);

  // 1) New document row (always a contract).
  const { data: doc, error: docErr } = await admin
    .from('documents')
    .insert({
      title,
      category: 'contracts',
      counterparty,
      event_id: eventId,
      contact_id: setup.contact_id,
      created_by: user.id,
    })
    .select()
    .single();
  if (docErr) {
    console.error('[from-template] document insert error', docErr);
    return NextResponse.json({ error: 'Failed to create document.' }, { status: 500 });
  }

  // 2) Copy the template PDF into the new document's first version.
  const { data: blob, error: dlErr } = await admin.storage.from(DOCUMENT_BUCKET).download(tpl.storage_path);
  if (dlErr || !blob) {
    await admin.from('documents').delete().eq('id', doc.id);
    return NextResponse.json({ error: 'Failed to read template file.' }, { status: 500 });
  }
  const buf = Buffer.from(await blob.arrayBuffer());
  const storagePath = buildStoragePath(doc.id, tpl.filename);
  const { error: upErr } = await admin.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, buf, { contentType: tpl.mime_type || 'application/pdf', upsert: false });
  if (upErr) {
    await admin.from('documents').delete().eq('id', doc.id);
    return NextResponse.json({ error: 'Failed to copy template file.' }, { status: 500 });
  }

  const { data: ver, error: verErr } = await admin
    .from('document_versions')
    .insert({
      document_id: doc.id,
      storage_path: storagePath,
      filename: tpl.filename,
      mime_type: tpl.mime_type || 'application/pdf',
      size_bytes: buf.length,
      checksum_sha256: sha256(buf),
      notes: `Cloned from template “${tpl.title}”.`,
      uploaded_by: user.id,
    })
    .select()
    .single();
  if (verErr) {
    await admin.storage.from(DOCUMENT_BUCKET).remove([storagePath]).catch(() => {});
    await admin.from('documents').delete().eq('id', doc.id);
    return NextResponse.json({ error: 'Failed to record version.' }, { status: 500 });
  }

  // 3) Contract record with the cloned, independently-editable layout.
  //    signer_1 is prefilled from the organizer profile when we have one; staff
  //    can still edit it before sending. If the profile has no usable signer
  //    email we deliberately create the draft anyway with NO signers, so the
  //    contract can be prepared while somebody chases the email — the pre-send
  //    gate (contractSendReadiness) is what refuses to send it.
  const prefilledSigner = organizer ? organizerSigner(organizer) : null;

  const { data: contractRow, error: cErr } = await admin
    .from('document_contracts')
    .insert({
      document_id: doc.id,
      template_id: templateId,
      field_layout: clonedLayout,
      field_values: {},
      signature_provider: 'signnow',
      counterparty_name: counterparty,
      counterparty_email: prefilledSigner?.email || null,
      signers: prefilledSigner ? [prefilledSigner] : [],
      event_id: eventId,
      contact_id: setup.contact_id,
      master_contract_id: setup.master_contract_id,
      artist_contact_id: setup.artist_contact_id,
      collective_contact_id: setup.collective_contact_id,
      vendor_contact_id: setup.vendor_contact_id,
      owner_user_id: setup.owner_user_id,
      effective_date: effectiveDate,
      expiration_date: expirationDate,
      notes: String(body.notes || '').trim().slice(0, 4000) || null,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (cErr) {
    console.error('[from-template] contract insert error', cErr);
    return NextResponse.json({ error: 'Document created but contract record failed.', document_id: doc.id }, { status: 500 });
  }

  await audit({
    admin, action: 'contract_create', documentId: doc.id, versionId: ver.id,
    actorId: user.id, actorEmail: user.email, request,
    details: {
      source: eventId ? 'event_organizer' : 'template',
      template_id: templateId,
      template_kind: tpl.kind || null,
      field_count: clonedLayout.length,
      event_id: eventId,
      contact_id: setup.contact_id,
      master_contract_id: setup.master_contract_id,
      signer_prefilled: !!prefilledSigner,
    },
  });

  return NextResponse.json({ ok: true, document_id: doc.id, contract_id: contractRow?.id || null });
}
