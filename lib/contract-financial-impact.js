// Pure, dependency-free helpers for reasoning about how deleting a contract
// document affects event financial calculations, and for deciding when an
// event financials view should warn that no contract terms are driving the
// split. Kept free of `@/` aliased imports so it runs under the Node test
// runner without a DB or Next's path resolver.
//
// Background: deleting a document cascades to its document_contracts row.
// event_financial_config.contract_id is ON DELETE SET NULL, so a financially
// linked contract silently disappears and the next summary falls back to
// "no split / Stardust keeps 100%" with no warning. These helpers surface
// that risk to the deletion route/UI and to the financials page.

// A contract carries financial weight when any structured split/fee term is
// set, or when its terms have been reviewed (provenance other than 'none').
export function contractHasFinancialTerms(contract) {
  if (!contract) return false;
  const splitSet = contract.stardust_split_percent != null;
  const flatFeeSet = contract.flat_fee_cents != null;
  const reviewed = !!contract.financial_terms_reviewed_at;
  const source = contract.financial_terms_source;
  const sourced = source != null && source !== 'none';
  return splitSet || flatFeeSet || reviewed || sourced;
}

// Decide the financial impact of deleting a contract document, given:
//   contract               — the document_contracts row (or null if none)
//   linkingConfigs         — event_financial_config rows whose contract_id
//                            == contract.id (an EXPLICIT pin to this contract)
//   autoResolvesForEventIds — event ids for which this contract is the one the
//                            split resolver (pickContractForSplit) would
//                            actually select AND the event has financial
//                            inputs. The caller computes this precisely so the
//                            guard matches the loader's behavior — deleting a
//                            dead/superseded contract that merely shares an
//                            event with a live signed one is NOT flagged.
//
// Returns:
//   {
//     financiallyLinked: boolean,  // true => deletion should be guarded
//     hasTerms: boolean,           // contract carried split/fee terms
//     explicitlyLinkedEventIds: string[], // configs pointing at this contract
//     autoResolvedEventIds: string[],     // events this contract drives via auto-resolve
//     linkedEventId: string|null,  // contract.event_id (auto-resolve link)
//     reasons: string[],           // human-readable why-it-matters strings
//   }
export function assessContractDeletionImpact({
  contract = null,
  linkingConfigs = [],
  autoResolvesForEventIds = [],
} = {}) {
  const reasons = [];
  const explicitlyLinkedEventIds = [];

  if (!contract) {
    return {
      financiallyLinked: false,
      hasTerms: false,
      explicitlyLinkedEventIds: [],
      autoResolvedEventIds: [],
      linkedEventId: null,
      reasons,
    };
  }

  const hasTerms = contractHasFinancialTerms(contract);

  for (const cfg of linkingConfigs || []) {
    if (cfg && cfg.event_id) explicitlyLinkedEventIds.push(cfg.event_id);
  }

  if (explicitlyLinkedEventIds.length) {
    reasons.push(
      `${explicitlyLinkedEventIds.length} event financial config(s) explicitly use this contract for split terms.`,
    );
  }

  // The auto-resolve link matters only when this contract is the one the split
  // resolver would actually pick for an event with inputs — not merely any
  // contract sharing the event id. The caller resolves this via
  // pickContractForSplit so the guard and the loader agree.
  const autoResolvedEventIds = (autoResolvesForEventIds || []).filter(Boolean);
  const autoResolveMatters = autoResolvedEventIds.length > 0;
  if (autoResolveMatters) {
    reasons.push(
      'This contract is the resolved split source for an event with financial inputs; deleting it makes that event fall back to 100% Stardust.',
    );
  }

  if (hasTerms && explicitlyLinkedEventIds.length) {
    reasons.push(
      'Deleting it removes reviewed split/flat-fee terms from those calculations.',
    );
  }

  const financiallyLinked =
    explicitlyLinkedEventIds.length > 0 || autoResolveMatters;

  return {
    financiallyLinked,
    hasTerms,
    explicitlyLinkedEventIds,
    autoResolvedEventIds,
    linkedEventId: contract.event_id || null,
    reasons,
  };
}

// Whether an event has any financial inputs at all. Used both to decide if a
// deletion matters and to decide if the financials page should warn about
// missing contract terms (warning only makes sense once there's something to
// split).
export function eventHasFinancialInputs({ metrics = null, posBatches = [], config = null } = {}) {
  const hasMetrics = !!metrics && (
    Number(metrics.tickets_sold) > 0 ||
    Number(metrics.gross_cents) > 0 ||
    Number(metrics.net_cents) > 0
  );
  const hasPos = Array.isArray(posBatches) && posBatches.some(
    (b) => b && (Number(b.in_window_count) > 0 || Number(b.net_cents) > 0 || Number(b.gross_cents) > 0),
  );
  // A persisted config row (vs. the in-memory default) signals an admin set up
  // this event's financials, so a missing contract is worth flagging even
  // before sales land.
  const hasConfig = !!config && config.id != null;
  return hasMetrics || hasPos || hasConfig;
}

// Compute the warning state for an event financials view. Pure over already
// loaded data. Returns null when there is nothing to warn about, else:
//   { kind, message }
// kinds:
//   'missing_contract_link' — config.contract_id was set but no longer resolves
//                             (e.g. the contract was deleted). Strongest signal.
//   'no_contract_terms'     — event has inputs but no resolved split terms, so
//                             the calc is defaulting to 100% Stardust.
export function buildFinancialsWarning({
  contract = null,
  contractTermsResolved = false,
  configContractId = null,
  hasInputs = false,
  snapshotApplied = false,
} = {}) {
  // A previously linked contract_id that no longer resolves to a contract is
  // the clearest evidence of a deletion/unlink that changed the books.
  if (configContractId && !contract) {
    return {
      kind: 'missing_contract_link',
      message: snapshotApplied
        ? 'The contract previously linked to this event is missing (deleted or unlinked). Using the saved snapshot of its reviewed terms — re-link a contract to resume live terms.'
        : 'The contract previously linked to this event is missing (deleted or unlinked). Split terms no longer apply — Stardust is keeping 100% of ticket net. Re-link a contract to restore the split.',
    };
  }

  if (hasInputs && !contractTermsResolved && !snapshotApplied) {
    return {
      kind: 'no_contract_terms',
      message: 'No contract terms found for this event — using the 100% Stardust default. Link a contract with reviewed split/flat-fee terms to apply a split.',
    };
  }

  return null;
}
