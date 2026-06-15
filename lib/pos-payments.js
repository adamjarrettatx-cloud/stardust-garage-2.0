// Processor-agnostic payment abstraction for the POS.
//
// The whole point of Phase 1 is that NO payment processor is finalized. Stripe
// is problematic for THCA/kava/kanna products, so the venue is evaluating
// Authorize.net and hemp/cannabis-friendly processors. To keep that decision
// open, every tender goes through a small adapter interface. Phase 1 ships only
// the two adapters that move no money through a card network:
//
//   * cash            — records a cash tender (drives the cash drawer / session)
//   * manual_external — records that a card was run on a SEPARATE standalone
//                       device; we only store the operator's reference number.
//
// Every other processor (Authorize.net, Stripe, Aeropay, …) is a PLACEHOLDER
// that deliberately throws if invoked, so nothing can accidentally "go live".
//
// An adapter implements:
//   key         : string id stored on pos_payments.processor_key (null for cash)
//   label       : human label
//   live        : whether it talks to a real money-movement network
//   capture({ amount_cents, reference, metadata }) -> Promise<{
//       status, processor_transaction_id, processor_key, metadata }>
//
// `capture` here NEVER contacts a network in Phase 1. It normalizes a payment
// record for persistence. Restricted-tender validation happens BEFORE this in
// lib/pos-helpers.js + the order route; adapters assume the tender is allowed.

import { isValidTender } from './pos-helpers.js';

class PaymentError extends Error {}

const cashAdapter = {
  key: null,
  tender: 'cash',
  label: 'Cash',
  live: false,
  async capture({ amount_cents, metadata = {} }) {
    const amt = Math.trunc(Number(amount_cents ?? 0));
    if (!(amt >= 0)) throw new PaymentError('Invalid cash amount.');
    return {
      status: 'succeeded',
      processor_key: null,
      processor_transaction_id: null,
      amount_cents: amt,
      metadata: { ...metadata, tender: 'cash' },
    };
  },
};

const manualExternalAdapter = {
  key: null,
  tender: 'manual_external',
  label: 'Manual External Card',
  live: false,
  // The card was charged on a standalone device OUTSIDE this POS. We only
  // record that it happened, plus an optional reference/last-4 the operator
  // types in. No processor is contacted.
  async capture({ amount_cents, reference, metadata = {} }) {
    const amt = Math.trunc(Number(amount_cents ?? 0));
    if (!(amt >= 0)) throw new PaymentError('Invalid amount.');
    const ref = reference ? String(reference).trim().slice(0, 64) : null;
    return {
      status: 'succeeded',
      processor_key: null,
      processor_transaction_id: ref,
      amount_cents: amt,
      metadata: { ...metadata, tender: 'manual_external', recorded_outside_pos: true },
    };
  },
};

const compAdapter = {
  key: null,
  tender: 'comp',
  label: 'Comp',
  live: false,
  async capture({ amount_cents, metadata = {} }) {
    return {
      status: 'succeeded',
      processor_key: null,
      processor_transaction_id: null,
      amount_cents: Math.max(0, Math.trunc(Number(amount_cents ?? 0))),
      metadata: { ...metadata, tender: 'comp' },
    };
  },
};

// Placeholder factory for processors that are NOT integrated yet. Any attempt
// to capture throws, so a misconfiguration fails loudly instead of silently
// pretending to charge a card.
function placeholderAdapter(key, label) {
  return {
    key,
    tender: 'card',
    label,
    live: true,
    placeholder: true,
    async capture() {
      throw new PaymentError(
        `Processor "${key}" is not integrated in Phase 1. ` +
        `Select and configure an adapter in Phase 2 before taking card payments.`
      );
    },
  };
}

// Registry of placeholder processors under consideration. These exist so the
// terminal config UI can offer a `payment_processor_key` without any of them
// being functional.
export const PLACEHOLDER_PROCESSORS = [
  placeholderAdapter('authorize_net', 'Authorize.net'),
  placeholderAdapter('aeropay', 'Aeropay (Pay-by-Bank)'),
  placeholderAdapter('stripe_terminal', 'Stripe Terminal'),
];

const PLACEHOLDER_BY_KEY = new Map(PLACEHOLDER_PROCESSORS.map((a) => [a.key, a]));

// Tender -> non-live adapter that's actually usable in Phase 1.
const PHASE1_ADAPTERS = {
  cash: cashAdapter,
  manual_external: manualExternalAdapter,
  comp: compAdapter,
};

// Resolve an adapter for a tender (+ optional processor key for card/ach).
// Throws for tenders that require a not-yet-integrated processor.
export function getPaymentAdapter(tender, processorKey = null) {
  if (!isValidTender(tender)) {
    throw new PaymentError(`Unknown tender type: ${tender}`);
  }

  const phase1 = PHASE1_ADAPTERS[tender];
  if (phase1) return phase1;

  // card / ach / other live tenders require a processor adapter.
  if (processorKey && PLACEHOLDER_BY_KEY.has(processorKey)) {
    return PLACEHOLDER_BY_KEY.get(processorKey);
  }

  throw new PaymentError(
    `Tender "${tender}" requires an integrated payment processor, which is not ` +
    `available in Phase 1. No card/ACH processing is wired up yet.`
  );
}

// True when a tender can be completed end-to-end in Phase 1 (no live network).
export function isPhase1Tender(tender) {
  return Object.prototype.hasOwnProperty.call(PHASE1_ADAPTERS, tender);
}

export { PaymentError };
