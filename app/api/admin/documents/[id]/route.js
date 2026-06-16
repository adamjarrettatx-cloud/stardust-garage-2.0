import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient, audit, DOCUMENT_BUCKET, DOCUMENT_CATEGORIES } from '@/lib/document-helpers';
import { assessContractDeletionImpact, eventHasFinancialInputs } from '@/lib/contract-financial-impact';
import { resolveEventContract } from '@/lib/event-financials-data';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f-]{36}$/i;
const VALID_CATEGORIES = new Set(DOCUMENT_CATEGORIES.map((c) => c.value));

// Inspect whether deleting this document removes a contract that feeds event
// financial calculations. Returns the impact assessment from the pure helper,
// enriched with the contract id. Safe to call for any document (no contract =>
// not financially linked).
async function loadDeletionImpact(admin, documentId) {
  const { data: contract } = await admin
    .from('document_contracts')
    .select('id, event_id, status, stardust_split_percent, flat_fee_cents, revenue_share_recipient, financial_terms_source, financial_terms_reviewed_at')
    .eq('document_id', documentId)
    .maybeSingle();

  if (!contract) {
    return { contractId: null, ...assessContractDeletionImpact({ contract: null }) };
  }

  // Event financial configs that explicitly pin this contract for split terms.
  const { data: linkingConfigs } = await admin
    .from('event_financial_config')
    .select('event_id, contract_id')
    .eq('contract_id', contract.id);

  // Auto-resolve impact: this contract matters to its linked event only when it
  // is the contract the split resolver (resolveEventContract -> pickContractForSplit)
  // would actually select for that event AND the event has financial inputs.
  // This mirrors the loader exactly, so deleting a dead/superseded contract
  // that merely shares an event with a live signed one is NOT flagged.
  const autoResolvesForEventIds = [];
  if (contract.event_id) {
    const [{ data: cfg }, { data: metrics }, { data: pos }] = await Promise.all([
      admin.from('event_financial_config').select('id, contract_id').eq('event_id', contract.event_id).maybeSingle(),
      admin.from('event_ticket_metrics').select('tickets_sold, gross_cents, net_cents').eq('event_id', contract.event_id).maybeSingle(),
      admin.from('pos_import_batches').select('in_window_count, gross_cents, net_cents').eq('event_id', contract.event_id),
    ]);
    const hasInputs = eventHasFinancialInputs({ metrics, posBatches: pos || [], config: cfg });
    if (hasInputs) {
      const resolved = await resolveEventContract(admin, contract.event_id, cfg?.contract_id ?? null);
      if (resolved && resolved.id === contract.id) autoResolvesForEventIds.push(contract.event_id);
    }
  }

  return {
    contractId: contract.id,
    ...assessContractDeletionImpact({ contract, linkingConfigs: linkingConfigs || [], autoResolvesForEventIds }),
  };
}

// GET /api/admin/documents/:id?impact=1 — deletion impact pre-flight so the UI
// can warn before removing a financially linked contract. Kept as a query
// branch on the base route to avoid adding a new file.
export async function GET(request, { params }) {
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const url = new URL(request.url);
  if (url.searchParams.get('impact') !== '1') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const admin = createAdminClient();
  const impact = await loadDeletionImpact(admin, id);
  return NextResponse.json({ ok: true, impact });
}

// PATCH /api/admin/documents/:id  -- update metadata and tags
export async function PATCH(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

  const patch = {};
  if (typeof body.title === 'string')        patch.title = body.title.trim();
  if (typeof body.description === 'string')  patch.description = body.description.trim() || null;
  if (typeof body.counterparty === 'string') patch.counterparty = body.counterparty.trim() || null;
  if (typeof body.category === 'string') {
    if (!VALID_CATEGORIES.has(body.category)) return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    patch.category = body.category;
  }
  if (typeof body.status === 'string') {
    if (!['draft', 'active', 'archived'].includes(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    patch.status = body.status;
  }
  if (body.event_id === null) patch.event_id = null;
  else if (typeof body.event_id === 'string' && UUID.test(body.event_id)) patch.event_id = body.event_id;

  const admin = createAdminClient();

  if (Object.keys(patch).length) {
    const { error } = await admin.from('documents').update(patch).eq('id', id);
    if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  // Replace tags if provided
  if (Array.isArray(body.tags)) {
    const tags = body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20);
    await admin.from('document_tags').delete().eq('document_id', id);
    if (tags.length) {
      await admin.from('document_tags').insert(tags.map((tag) => ({ document_id: id, tag })));
    }
  }

  await audit({
    admin, action: 'update_metadata', documentId: id,
    actorId: user.id, actorEmail: user.email, request, details: { patch, tags: body.tags ?? null },
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/documents/:id  -- hard delete with cascade + storage cleanup
export async function DELETE(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();

  // Guard: if this document is a contract feeding event financial calculations,
  // require an explicit confirmation flag. This prevents silently removing
  // split/flat-fee terms (which would make affected events fall back to
  // "100% Stardust") on a routine delete. The UI surfaces the impact first.
  const url = new URL(request.url);
  const confirmed = url.searchParams.get('confirmFinancial') === '1';
  const impact = await loadDeletionImpact(admin, id);
  if (impact.financiallyLinked && !confirmed) {
    return NextResponse.json(
      { error: 'Financially linked contract', code: 'financial_link', impact },
      { status: 409 },
    );
  }

  // Collect storage paths first
  const { data: versions } = await admin
    .from('document_versions')
    .select('storage_path')
    .eq('document_id', id);

  // Audit BEFORE delete so we still have FK validity
  await audit({
    admin, action: 'delete', documentId: id,
    actorId: user.id, actorEmail: user.email, request,
    details: { version_count: versions?.length || 0, financial_impact: impact.financiallyLinked ? impact : null },
  });

  // Delete row (cascades to versions + tags; audit log keeps history because FK ON DELETE SET NULL)
  const { error: delErr } = await admin.from('documents').delete().eq('id', id);
  if (delErr) return NextResponse.json({ error: 'Delete failed' }, { status: 500 });

  if (versions?.length) {
    await admin.storage.from(DOCUMENT_BUCKET).remove(versions.map((v) => v.storage_path));
  }

  return NextResponse.json({ ok: true });
}
