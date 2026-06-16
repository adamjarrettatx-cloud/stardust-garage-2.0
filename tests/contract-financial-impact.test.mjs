import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contractHasFinancialTerms,
  assessContractDeletionImpact,
  eventHasFinancialInputs,
  buildFinancialsWarning,
} from '../lib/contract-financial-impact.js';

// ---------------------------------------------------------------------------
// contractHasFinancialTerms
// ---------------------------------------------------------------------------
test('contractHasFinancialTerms is false for null / bare contract', () => {
  assert.equal(contractHasFinancialTerms(null), false);
  assert.equal(contractHasFinancialTerms({ financial_terms_source: 'none' }), false);
  assert.equal(contractHasFinancialTerms({ stardust_split_percent: null, flat_fee_cents: null }), false);
});

test('contractHasFinancialTerms is true when any term/provenance is set', () => {
  assert.equal(contractHasFinancialTerms({ stardust_split_percent: 50 }), true);
  assert.equal(contractHasFinancialTerms({ flat_fee_cents: 50000 }), true);
  assert.equal(contractHasFinancialTerms({ financial_terms_source: 'manual' }), true);
  assert.equal(contractHasFinancialTerms({ financial_terms_reviewed_at: '2026-06-16T00:00:00Z' }), true);
});

// ---------------------------------------------------------------------------
// assessContractDeletionImpact
// ---------------------------------------------------------------------------
test('no contract => not financially linked', () => {
  const r = assessContractDeletionImpact({ contract: null });
  assert.equal(r.financiallyLinked, false);
  assert.equal(r.hasTerms, false);
  assert.deepEqual(r.explicitlyLinkedEventIds, []);
});

test('contract with no terms and no links is not financially linked', () => {
  const r = assessContractDeletionImpact({
    contract: { id: 'c1', event_id: null, financial_terms_source: 'none' },
    linkingConfigs: [],
    eventInputsById: {},
  });
  assert.equal(r.financiallyLinked, false);
});

test('an explicit config link makes deletion financially linked even without terms', () => {
  // A config that pins this contract_id means an admin chose it; deleting it
  // nulls that link, so it must be guarded regardless of term richness.
  const r = assessContractDeletionImpact({
    contract: { id: 'c1', event_id: null, financial_terms_source: 'none' },
    linkingConfigs: [{ event_id: 'e1' }],
    eventInputsById: {},
  });
  assert.equal(r.financiallyLinked, true);
  assert.deepEqual(r.explicitlyLinkedEventIds, ['e1']);
  assert.ok(r.reasons.length >= 1);
});

test('auto-resolve link matters only with terms AND event inputs', () => {
  const base = { id: 'c1', event_id: 'e1', stardust_split_percent: 50, financial_terms_source: 'manual' };

  // Has terms + event has inputs => linked.
  const linked = assessContractDeletionImpact({
    contract: base, linkingConfigs: [], eventInputsById: { e1: true },
  });
  assert.equal(linked.financiallyLinked, true);

  // Has terms but event has no inputs => not linked (nothing to change yet).
  const noInputs = assessContractDeletionImpact({
    contract: base, linkingConfigs: [], eventInputsById: { e1: false },
  });
  assert.equal(noInputs.financiallyLinked, false);

  // No terms but event has inputs => not linked via auto-resolve.
  const noTerms = assessContractDeletionImpact({
    contract: { id: 'c1', event_id: 'e1', financial_terms_source: 'none' },
    linkingConfigs: [], eventInputsById: { e1: true },
  });
  assert.equal(noTerms.financiallyLinked, false);
});

// ---------------------------------------------------------------------------
// eventHasFinancialInputs
// ---------------------------------------------------------------------------
test('eventHasFinancialInputs detects metrics, pos, or a persisted config', () => {
  assert.equal(eventHasFinancialInputs({}), false);
  assert.equal(eventHasFinancialInputs({ metrics: { tickets_sold: 0, gross_cents: 0 } }), false);
  assert.equal(eventHasFinancialInputs({ metrics: { tickets_sold: 10 } }), true);
  assert.equal(eventHasFinancialInputs({ posBatches: [{ in_window_count: 3 }] }), true);
  assert.equal(eventHasFinancialInputs({ posBatches: [{ in_window_count: 0, net_cents: 0 }] }), false);
  assert.equal(eventHasFinancialInputs({ config: { id: 'cfg1' } }), true);
  assert.equal(eventHasFinancialInputs({ config: { id: null } }), false);
});

// ---------------------------------------------------------------------------
// buildFinancialsWarning
// ---------------------------------------------------------------------------
test('no warning when contract terms resolve', () => {
  const w = buildFinancialsWarning({
    contract: { id: 'c1' }, contractTermsResolved: true, hasInputs: true,
  });
  assert.equal(w, null);
});

test('missing_contract_link warns when configContractId set but no contract resolves', () => {
  const w = buildFinancialsWarning({
    contract: null, contractTermsResolved: false, configContractId: 'gone', hasInputs: true,
  });
  assert.equal(w.kind, 'missing_contract_link');
  assert.match(w.message, /100% of ticket net|missing/i);
});

test('missing_contract_link message reflects an applied snapshot', () => {
  const w = buildFinancialsWarning({
    contract: null, contractTermsResolved: false, configContractId: 'gone', hasInputs: true, snapshotApplied: true,
  });
  assert.equal(w.kind, 'missing_contract_link');
  assert.match(w.message, /snapshot/i);
});

test('no_contract_terms warns when event has inputs but no terms and no snapshot', () => {
  const w = buildFinancialsWarning({
    contract: null, contractTermsResolved: false, configContractId: null, hasInputs: true,
  });
  assert.equal(w.kind, 'no_contract_terms');
  assert.match(w.message, /100% Stardust default/i);
});

test('no warning when a snapshot covers the missing terms (no prior link)', () => {
  const w = buildFinancialsWarning({
    contract: null, contractTermsResolved: false, configContractId: null, hasInputs: true, snapshotApplied: true,
  });
  assert.equal(w, null);
});

test('no warning when event has no inputs at all', () => {
  const w = buildFinancialsWarning({
    contract: null, contractTermsResolved: false, configContractId: null, hasInputs: false,
  });
  assert.equal(w, null);
});
