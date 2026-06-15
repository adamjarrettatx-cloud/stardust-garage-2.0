// Shared POS constants + pure helpers (calculation + restricted-tender rules).
//
// Intentionally dependency-free and side-effect-free so they can be imported
// from server route handlers, client components, and the test suite alike.
// All money is in integer CENTS — never floats — to avoid rounding drift.
//
// Phase 1 has NO live card processing. These helpers only compute totals and
// enforce which tender types are *allowed* for a given cart. Actually moving
// money is the payment adapter's job (see lib/pos-payments.js), which in
// Phase 1 only records cash / manual-external tenders.

// ---------------------------------------------------------------------------
// Tender types
// ---------------------------------------------------------------------------
// `comp` is an admin-authorized tender (free sale): it is NOT offered on the
// register and is rejected by the order route unless the caller is an admin and
// supplies a reason. See requiresAdminTender / the order route. `other` was
// removed entirely — it had no Phase 1 adapter and always 422'd at checkout.
export const TENDER_TYPES = [
  { value: 'cash',            label: 'Cash',                 phase1: true,  register: true  },
  { value: 'manual_external', label: 'Manual External Card', phase1: true,  register: true  },
  { value: 'card',            label: 'Card (Integrated)',    phase1: false, register: false },
  { value: 'ach',             label: 'ACH / Pay-by-Bank',    phase1: false, register: false },
  { value: 'comp',            label: 'Comp (admin)',         phase1: true,  register: false },
];

export const TENDER_VALUES = new Set(TENDER_TYPES.map((t) => t.value));

// Tenders that require admin-level authorization (plus a reason) to use. `comp`
// is a free sale and must never be a one-tap action for an ordinary cashier.
export const ADMIN_ONLY_TENDERS = new Set(['comp']);

export function requiresAdminTender(tender) {
  return ADMIN_ONLY_TENDERS.has(tender);
}

// Tenders that actually run through a card/processor network. Restricted SKUs
// flagged cash_only or approved_processor_only must never use a "mainstream
// processor" tender unless that processor is explicitly approved.
export const PROCESSOR_TENDERS = new Set(['card', 'ach']);

// 'manual_external' means an operator ran the card on a SEPARATE standalone
// device (not this POS) and is only recording that it happened. It does not
// touch our processor, so for restricted-tender purposes it is treated as an
// out-of-band tender, NOT a mainstream-processor charge.
export const OUT_OF_BAND_TENDERS = new Set(['manual_external', 'comp']);

// ---------------------------------------------------------------------------
// Restricted-tender policies (mirror the DB CHECK constraints)
// ---------------------------------------------------------------------------
export const RESTRICTED_TENDER_POLICIES = [
  {
    value: 'none',
    label: 'No restriction',
    help: 'Chargeable on any tender.',
  },
  {
    value: 'cash_only',
    label: 'Cash only',
    help: 'THCA/kava/kanna-style item. Cash tender only — no card/ACH/manual.',
  },
  {
    value: 'approved_processor_only',
    label: 'Approved processor only',
    help: 'May only be charged via cash or an approved hemp-friendly processor — never a mainstream card/ACH tender.',
  },
];

export const RESTRICTED_TENDER_POLICY_VALUES = new Set(
  RESTRICTED_TENDER_POLICIES.map((p) => p.value)
);

export function isValidTender(tender) {
  return TENDER_VALUES.has(tender);
}

export function isValidRestrictedPolicy(policy) {
  return RESTRICTED_TENDER_POLICY_VALUES.has(policy);
}

// ---------------------------------------------------------------------------
// Money / rounding
// ---------------------------------------------------------------------------

// Round to the nearest cent using half-up. Input/output are integer cents, but
// tax math produces fractional cents we must collapse deterministically.
function roundCents(n) {
  return Math.round(n);
}

// Effective tax rate (basis points) for a line: 0 when the product is not
// taxable, otherwise its configured rate.
export function effectiveTaxBps(item) {
  if (!item || item.taxable === false) return 0;
  const bps = Number(item.tax_rate_bps ?? 0);
  return Number.isFinite(bps) && bps > 0 ? Math.trunc(bps) : 0;
}

// ---------------------------------------------------------------------------
// Line + cart calculation
// ---------------------------------------------------------------------------

// Compute a single line. `item` needs at least { price_cents, quantity }.
// Tax is computed on the post-discount line subtotal. Returns integer cents.
export function calcLine(item) {
  const qty = Math.max(0, Math.trunc(Number(item?.quantity ?? 1)));
  const unit = Math.max(0, Math.trunc(Number(item?.price_cents ?? item?.unit_price_cents ?? 0)));
  const lineDiscount = Math.max(0, Math.trunc(Number(item?.discount_cents ?? 0)));

  const gross = unit * qty;
  const subtotal = Math.max(0, gross - lineDiscount);
  const taxBps = effectiveTaxBps(item);
  const tax = roundCents((subtotal * taxBps) / 10000);

  return {
    quantity: qty,
    unit_price_cents: unit,
    discount_cents: lineDiscount,
    subtotal_cents: subtotal,
    tax_cents: tax,
    line_total_cents: subtotal + tax,
    restricted_tender_policy: isValidRestrictedPolicy(item?.restricted_tender_policy)
      ? item.restricted_tender_policy
      : 'none',
  };
}

// Compute a whole cart. `items` is an array of product-ish line inputs.
// `orderDiscountCents` is an optional order-level discount applied after lines.
// Returns { subtotal_cents, tax_cents, discount_cents, total_cents,
//           restricted_items_present, lines: [...] }.
export function calcCart(items = [], orderDiscountCents = 0) {
  const lines = (Array.isArray(items) ? items : []).map(calcLine);

  const lineDiscountTotal = lines.reduce((s, l) => s + l.discount_cents, 0);
  const subtotal = lines.reduce((s, l) => s + l.subtotal_cents, 0);
  const tax = lines.reduce((s, l) => s + l.tax_cents, 0);

  const orderDiscount = Math.max(0, Math.trunc(Number(orderDiscountCents ?? 0)));
  // Order-level discount cannot pull the total below the tax owed.
  const cappedOrderDiscount = Math.min(orderDiscount, subtotal);

  const total = Math.max(0, subtotal - cappedOrderDiscount + tax);
  const restricted_items_present = lines.some((l) => l.restricted_tender_policy !== 'none');

  return {
    subtotal_cents: subtotal,
    tax_cents: tax,
    discount_cents: lineDiscountTotal + cappedOrderDiscount,
    total_cents: total,
    restricted_items_present,
    lines,
  };
}

// ---------------------------------------------------------------------------
// Restricted-tender validation — the core compliance rule
// ---------------------------------------------------------------------------

// Given a cart's items and a chosen tender, decide whether the sale is allowed.
//
// Rules:
//   * cash_only items   -> ONLY 'cash' is allowed.
//   * approved_processor_only items -> 'cash' always ok; mainstream-processor
//       tenders ('card','ach') are BLOCKED; out-of-band tenders
//       ('manual_external','comp','other') are allowed because they do not run
//       through our mainstream processor. An integrated processor tender would
//       only be allowed once an APPROVED processor adapter exists (Phase 2),
//       which is out of scope here.
//   * 'none' items      -> any valid tender.
//
// Returns { allowed: boolean, reason: string|null, offendingItems: [...] }.
export function validateTenderForCart(items, tender) {
  if (!isValidTender(tender)) {
    return { allowed: false, reason: `Unknown tender type: ${tender}`, offendingItems: [] };
  }

  const list = Array.isArray(items) ? items : [];
  const offending = [];

  for (const item of list) {
    const policy = isValidRestrictedPolicy(item?.restricted_tender_policy)
      ? item.restricted_tender_policy
      : 'none';
    if (policy === 'none') continue;

    if (policy === 'cash_only' && tender !== 'cash') {
      offending.push({ item, policy });
      continue;
    }

    if (policy === 'approved_processor_only') {
      // Mainstream processor tenders are never allowed for these items in
      // Phase 1 (no approved adapter wired up yet).
      if (PROCESSOR_TENDERS.has(tender)) {
        offending.push({ item, policy });
      }
    }
  }

  if (offending.length > 0) {
    const names = offending
      .map((o) => o.item?.name || o.item?.name_snapshot || o.item?.sku || 'item')
      .filter((v, i, a) => a.indexOf(v) === i);
    const tenderLabel = TENDER_TYPES.find((t) => t.value === tender)?.label || tender;
    return {
      allowed: false,
      reason: `${names.join(', ')} cannot be sold via ${tenderLabel}.`,
      offendingItems: offending,
    };
  }

  return { allowed: true, reason: null, offendingItems: [] };
}

// Which tenders are usable for a given cart right now. Drives enabling/disabling
// the tender buttons in the register UI. Only register-facing Phase 1 tenders
// are returned (comp is admin-only and never surfaced here); the `enabled` flag
// reflects restricted-tender validation.
export function allowedTendersForCart(items) {
  return TENDER_TYPES
    .filter((t) => t.phase1 && t.register)
    .map((t) => ({
      ...t,
      enabled: validateTenderForCart(items, t.value).allowed,
    }));
}

// ---------------------------------------------------------------------------
// Server-owned cart assembly — the canonical-price enforcement point
// ---------------------------------------------------------------------------

// Build calc-ready line inputs from CLIENT-supplied { product_id, quantity }
// requests joined against CANONICAL pos_products rows loaded server-side. The
// client never gets to dictate price, tax, name, sku, or restricted-tender
// policy — those always come from the DB. Inactive or unknown products are
// rejected so a removed/disabled SKU can't be rung up.
//
//   requests : [{ product_id, quantity }]  (client input)
//   products : [pos_products row, ...]      (DB rows, server-loaded)
//
// Returns { items, error }. `items` is an array of canonical line inputs
// (suitable for calcCart / validateTenderForCart). `error` is a string when the
// request is invalid, in which case `items` is null.
export function buildCanonicalCartItems(requests, products) {
  const reqList = Array.isArray(requests) ? requests : [];
  if (!reqList.length) return { items: null, error: 'Cart is empty.' };

  const byId = new Map((Array.isArray(products) ? products : []).map((p) => [p.id, p]));
  const items = [];

  for (const req of reqList) {
    const productId = req?.product_id;
    if (typeof productId !== 'string' || !productId) {
      return { items: null, error: 'Each cart item requires a product_id.' };
    }
    const qty = Math.trunc(Number(req?.quantity ?? 0));
    if (!Number.isFinite(qty) || qty <= 0) {
      return { items: null, error: 'Each cart item requires a positive quantity.' };
    }

    const product = byId.get(productId);
    if (!product) {
      return { items: null, error: `Unknown product: ${productId}` };
    }
    if (product.active === false) {
      return { items: null, error: `Product is not available for sale: ${product.name || productId}` };
    }

    items.push({
      product_id: product.id,
      name: product.name,
      sku: product.sku || null,
      price_cents: product.price_cents,
      quantity: qty,
      taxable: product.taxable,
      tax_rate_bps: product.tax_rate_bps,
      restricted_tender_policy: isValidRestrictedPolicy(product.restricted_tender_policy)
        ? product.restricted_tender_policy
        : 'none',
    });
  }

  return { items, error: null };
}

// ---------------------------------------------------------------------------
// Order number generation (human-friendly, non-secret)
// ---------------------------------------------------------------------------
export function formatOrderNumber(seq, date = new Date()) {
  const year = date.getUTCFullYear();
  const padded = String(seq).padStart(6, '0');
  return `SG-${year}-${padded}`;
}

// Format integer cents as a USD string for display.
export function formatCents(cents) {
  const n = Number(cents ?? 0) / 100;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
