// Server-only loader that gathers the three financial inputs for an event from
// the database and runs them through the pure calculator in
// lib/event-financials.js. Imported by the admin financials route and the
// admin event financials page so both render identical numbers.
//
// Inputs gathered:
//   * event_financial_config       — CPT fee, tax/cc rates, optional contract link
//   * event_ticket_metrics         — cached TicketTailor sales (ticket revenue)
//   * pos_import_batches           — POS roll-ups (already window-filtered)
//   * document_contracts           — split %, flat fee, recipient (the terms)
//
// Requires a service-role admin client (callers gate access first).

import { buildEventFinancialSummary } from '@/lib/event-financials';
import { pickContractForSplit } from '@/lib/event-financials-select';
import { buildFinancialsWarning, eventHasFinancialInputs } from '@/lib/contract-financial-impact';

// Build split terms from a config's snapshot columns, or null when no snapshot
// has been taken. Used as a fallback so deleting a contract does not silently
// change a closed event's books.
function snapshotTerms(config) {
  if (!config || config.snapshot_taken_at == null) return null;
  if (config.snapshot_stardust_split_percent == null && config.snapshot_flat_fee_cents == null) {
    return null;
  }
  return {
    stardust_split_percent: config.snapshot_stardust_split_percent,
    flat_fee_cents: config.snapshot_flat_fee_cents,
    revenue_share_recipient: config.snapshot_revenue_share_recipient || 'stardust',
  };
}

const DEFAULT_CONFIG = { tt_cpt_fee_cents: 52, sales_tax_bps: 0, cc_fee_bps: 0, contract_id: null };

// Pick the contract whose terms drive the split: the config's explicit
// contract_id if set and found, else the best linked contract per
// pickContractForSplit.
export async function resolveEventContract(admin, eventId, configContractId) {
  if (configContractId) {
    const { data } = await admin
      .from('document_contracts')
      .select('id, document_id, status, stardust_split_percent, flat_fee_cents, revenue_share_recipient, financial_terms, financial_terms_source')
      .eq('id', configContractId)
      .maybeSingle();
    if (data) return data;
  }
  const { data: linked } = await admin
    .from('document_contracts')
    .select('id, document_id, status, stardust_split_percent, flat_fee_cents, revenue_share_recipient, financial_terms, financial_terms_source')
    .eq('event_id', eventId)
    .order('updated_at', { ascending: false });
  return pickContractForSplit(linked);
}

export async function loadEventFinancials(admin, eventId) {
  const { data: event } = await admin
    .from('events')
    .select('id, title, event_date')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) return null;

  const { data: configRow } = await admin
    .from('event_financial_config')
    .select('*')
    .eq('event_id', eventId)
    .maybeSingle();
  const config = configRow || DEFAULT_CONFIG;

  const { data: metrics } = await admin
    .from('event_ticket_metrics')
    .select('tickets_sold, orders_count, gross_cents, fees_cents, net_cents, status, fetched_at')
    .eq('event_id', eventId)
    .maybeSingle();

  const { data: posBatches } = await admin
    .from('pos_import_batches')
    .select('id, source_filename, window_start, window_end, in_window_count, gross_cents, tax_cents, cc_fee_cents, net_cents, created_at')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });

  const contract = await resolveEventContract(admin, eventId, config.contract_id);

  // Live contract terms win. When no contract resolves, fall back to a saved
  // snapshot (if any) so deleting/unlinking a contract does not retroactively
  // change a closed event's books.
  const snapshot = contract ? null : snapshotTerms(config);
  const liveTerms = contract
    ? {
        stardust_split_percent: contract.stardust_split_percent,
        flat_fee_cents: contract.flat_fee_cents,
        revenue_share_recipient: contract.revenue_share_recipient,
      }
    : null;
  const terms = liveTerms || snapshot || {};

  const summary = buildEventFinancialSummary({
    metrics: metrics || null,
    posBatches: posBatches || [],
    config,
    terms,
  });

  const hasInputs = eventHasFinancialInputs({
    metrics: metrics || null,
    posBatches: posBatches || [],
    config: configRow || null,
  });
  const warning = buildFinancialsWarning({
    contract,
    contractTermsResolved: !!contract,
    configContractId: config.contract_id ?? null,
    hasInputs,
    snapshotApplied: !!snapshot,
  });

  return {
    event,
    config: {
      tt_cpt_fee_cents: config.tt_cpt_fee_cents ?? 52,
      sales_tax_bps: config.sales_tax_bps ?? 0,
      cc_fee_bps: config.cc_fee_bps ?? 0,
      contract_id: config.contract_id ?? null,
      notes: config.notes ?? null,
    },
    metrics: metrics || null,
    metricsStatus: metrics?.status || 'none',
    posBatches: posBatches || [],
    contract: contract
      ? {
          id: contract.id,
          document_id: contract.document_id,
          status: contract.status,
          stardust_split_percent: contract.stardust_split_percent,
          flat_fee_cents: contract.flat_fee_cents,
          revenue_share_recipient: contract.revenue_share_recipient,
          financial_terms_source: contract.financial_terms_source,
        }
      : null,
    snapshot: snapshot
      ? {
          stardust_split_percent: config.snapshot_stardust_split_percent ?? null,
          flat_fee_cents: config.snapshot_flat_fee_cents ?? null,
          revenue_share_recipient: config.snapshot_revenue_share_recipient ?? null,
          taken_at: config.snapshot_taken_at ?? null,
        }
      : null,
    warning,
    summary,
  };
}
