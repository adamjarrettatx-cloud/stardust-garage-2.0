import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isContractTemplatesEnabled } from '@/lib/feature-flags';
import {
  contractSendReadiness,
  isEventOrganizer,
  organizerDisplayLabel,
  defaultSignerEmail,
} from '@/lib/event-organizer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// Everything the Event Contracts panel needs, in one request:
//
//   * the event's linked Event Organizer profile (the counterparty),
//   * every contract already attached to this event,
//   * that organizer's Master Agreements (so an Event Agreement can reference
//     the applicable one),
//   * the active templates staff may start from.
//
// Read-only and admin+MFA gated. Deliberately does NOT return
// external_envelope_id, storage paths, field_layout or field_values: the panel
// only needs to list and route, and the less contract internals travel to the
// browser the smaller the blast radius. The detail page (which is already gated)
// remains the only place that loads the full contract.
export async function GET(_request, { params }) {
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();

  const { data: event, error: eventErr } = await admin
    .from('events')
    .select('id, title, event_date, is_sdg_only, contact_id')
    .eq('id', id)
    .maybeSingle();
  if (eventErr) {
    console.error('[event.contracts.list] event load failed', eventErr);
    return NextResponse.json({ error: 'Could not load this event' }, { status: 500 });
  }
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  // The organizer profile behind this event, if any. is_sdg_only events have no
  // counterparty by design, and that is a legitimate "nothing to sign" state.
  let organizer = null;
  if (event.contact_id) {
    const { data } = await admin
      .from('contacts')
      .select(
        'id, display_name, legal_name, entity_type, contact_type, status, email, phone, ' +
          'primary_contact_name, default_signer_name, default_signer_email, ' +
          'address_line1, address_line2, address_city, address_state, address_postal_code, address_country',
      )
      .eq('id', event.contact_id)
      .maybeSingle();
    organizer = data || null;
  }

  const { data: contracts, error: cErr } = await admin
    .from('document_contracts')
    .select(
      'id, document_id, status, counterparty_name, counterparty_email, signers, ' +
        'template_id, master_contract_id, contact_id, effective_date, expiration_date, ' +
        'sent_at, last_sent_at, send_count, viewed_at, completed_at, created_at, ' +
        'field_layout, field_values, ' +
        'documents:document_id (id, title, status), ' +
        'contract_templates:template_id (id, title, kind, requires_master)',
    )
    .eq('event_id', id)
    .order('created_at', { ascending: false });
  if (cErr) {
    console.error('[event.contracts.list] contracts load failed', cErr);
    return NextResponse.json({ error: 'Could not load contracts for this event' }, { status: 500 });
  }

  // Strip the field data down to a readiness verdict before it leaves the server.
  // Staff need to know "can this be sent and if not why", not the layout itself.
  const rows = (contracts || []).map((c) => {
    const readiness = contractSendReadiness({
      contract: c,
      organizer,
      template: c.contract_templates || null,
    });
    const { field_layout, field_values, ...rest } = c;
    return {
      ...rest,
      title: c.documents?.title || c.counterparty_name || 'Contract',
      template_title: c.contract_templates?.title || null,
      template_kind: c.contract_templates?.kind || null,
      field_count: Array.isArray(field_layout) ? field_layout.length : 0,
      filled_count: field_values && typeof field_values === 'object' ? Object.keys(field_values).length : 0,
      signer_count: Array.isArray(c.signers) ? c.signers.length : 0,
      ready_to_send: readiness.ok,
      blockers: readiness.errors || [],
      warnings: readiness.warnings || [],
    };
  });

  // Master Agreements available to reference from an Event Agreement: this
  // organizer's masters only, and only ones that actually exist as a real
  // agreement (a draft master is not something an event can hang off).
  let masters = [];
  if (organizer) {
    const { data } = await admin
      .from('document_contracts')
      .select(
        'id, document_id, status, effective_date, expiration_date, created_at, ' +
          'documents:document_id (title), contract_templates:template_id (kind)',
      )
      .eq('contact_id', organizer.id)
      .neq('status', 'draft')
      .order('created_at', { ascending: false });
    masters = (data || [])
      .filter((m) => m.contract_templates?.kind === 'master')
      .map((m) => ({
        id: m.id,
        document_id: m.document_id,
        title: m.documents?.title || 'Master Agreement',
        status: m.status,
        effective_date: m.effective_date,
        expiration_date: m.expiration_date,
      }));
  }

  // Templates to start from. Only meaningful when the contract-templates feature
  // is on; when it's off the panel renders read-only so nothing 404s mid-flow.
  const templatesEnabled = isContractTemplatesEnabled();
  let templates = [];
  if (templatesEnabled) {
    const { data } = await admin
      .from('contract_templates')
      .select('id, title, description, kind, requires_master, page_count, field_layout')
      .eq('is_active', true)
      .order('title', { ascending: true });
    templates = (data || []).map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      kind: t.kind || 'other',
      requires_master: !!t.requires_master,
      page_count: t.page_count,
      field_count: Array.isArray(t.field_layout) ? t.field_layout.length : 0,
    }));
  }

  return NextResponse.json({
    ok: true,
    templates_enabled: templatesEnabled,
    event: {
      id: event.id,
      title: event.title,
      event_date: event.event_date,
      is_sdg_only: event.is_sdg_only,
    },
    organizer: organizer
      ? {
          ...organizer,
          is_event_organizer: isEventOrganizer(organizer),
          display_label: organizerDisplayLabel(organizer),
          signer_email: defaultSignerEmail(organizer),
        }
      : null,
    contracts: rows,
    masters,
    templates,
  });
}
