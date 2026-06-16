import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contractHasFinancialTerms,
  assessContractDeletionImpact,
  eventHasFinancialInputs,
  buildFinancialsWarning,
} from '../lib/contract-financial-impact.js';
import { pickContractForSplit } from '../lib/event-financials-select.js';

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
    autoResolvesForEventIds: [],
  });
  assert.equal(r.financiallyLinked, false);
});

test('an explicit config link makes deletion financially linked even without terms', () => {
  // A config that pins this contract_id means an admin chose it; deleting it
  // nulls that link, so it must be guarded regardless of term richness.
  const r = assessContractDeletionImpact({
    contract: { id: 'c1', event_id: null, financial_terms_source: 'none' },
    linkingConfigs: [{ event_id: 'e1' }],
    autoResolvesForEventIds: [],
  });
  assert.equal(r.financiallyLinked, true);
  assert.deepEqual(r.explicitlyLinkedEventIds, ['e1']);
  assert.ok(r.reasons.length >= 1);
});

test('auto-resolve link is driven by the caller-resolved event id list', () => {
  // The caller (route) resolves via pickContractForSplit and passes only the
  // events this contract actually drives. The helper trusts that precise list.
  const base = { id: 'c1', event_id: 'e1', stardust_split_percent: 50, financial_terms_source: 'manual' };

  // This contract is the resolved split source for e1 => linked.
  const linked = assessContractDeletionImpact({
    contract: base, linkingConfigs: [], autoResolvesForEventIds: ['e1'],
  });
  assert.equal(linked.financiallyLinked, true);
  assert.deepEqual(linked.autoResolvedEventIds, ['e1']);

  // Shares e1 but is NOT the resolved contract (e.g. a dead/superseded contract
  // behind a live signed one) => caller passes an empty list => not linked.
  const notResolved = assessContractDeletionImpact({
    contract: base, linkingConfigs: [], autoResolvesForEventIds: [],
  });
  assert.equal(notResolved.financiallyLinked, false);
  assert.deepEqual(notResolved.autoResolvedEventIds, []);
});

test('deletion guard resolver: a dead contract sharing an event with a signed one is not the split source', () => {
  // This is the false-positive scenario from review. The route resolves the
  // event's split contract via pickContractForSplit before flagging an
  // auto-resolve link; a declined contract loses to a signed one, so deleting
  // it would resolve to a different id and the route passes NO event id.
  const linked = [
    { id: 'signed', status: 'signed' },
    { id: 'declined', status: 'declined' },
  ];
  const resolved = pickContractForSplit(linked);
  assert.equal(resolved.id, 'signed');
  // The contract being deleted (declined) is not the resolved one =>
  // autoResolvesForEventIds stays empty => not flagged.
  const r = assessContractDeletionImpact({
    contract: { id: 'declined', event_id: 'e1', status: 'declined' },
    linkingConfigs: [],
    autoResolvesForEventIds: resolved.id === 'declined' ? ['e1'] : [],
  });
  assert.equal(r.financiallyLinked, false);
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
