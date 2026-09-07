// Small pure helpers for pricing math + tier resolution.
//
// Kept dependency-free so they're trivially unit-testable. Everything here
// is server-authoritative — the client can compute the same numbers for a
// preview, but the server never trusts client-provided prices.

// ---------------------------------------------------------------------------
// Sales tax (Texas)
// ---------------------------------------------------------------------------
//
// Every ticket order collects 8.25% Texas sales tax on the taxable base of
// (subtotal - discount + booking_fee). Tax is added on top of the buyer's
// pre-tax total; Stripe's processing fee is NOT passed to the buyer (SDG
// absorbs it out of the payout). We expose the rate in basis points so
// downstream consumers (API responses, buyer widget) don't hardcode 825.
export const TEXAS_SALES_TAX_RATE_BPS = 825; // 8.25%

// Convert basis points to a fractional rate (825 -> 0.0825). Kept private
// so callers stay in the bps unit and don't reintroduce float mismatch.
function bpsToRate(bps) {
  return bps / 10000;
}

// Compute Texas sales tax on a taxable base in cents. Rounded to whole cents
// (half-up) so the buyer never sees fractional cents, and so back-solving
// for a target total lands exactly on the requested amount.
export function computeTaxCents(taxableBaseCents, rateBps = TEXAS_SALES_TAX_RATE_BPS) {
  const base = Math.max(0, Number(taxableBaseCents) || 0);
  return Math.round(base * bpsToRate(rateBps));
}

// Stripe processing fee: 2.9% + $0.30. Buyer never sees this; used only by
// admin previews and by the target_total back-solve when we want to display
// "you'll net $X after Stripe".
export const STRIPE_FEE_BPS = 290;
export const STRIPE_FEE_FIXED_CENTS = 30;
export function computeStripeFeeCents(chargeCents) {
  const c = Math.max(0, Number(chargeCents) || 0);
  if (c === 0) return 0;
  return Math.round(c * bpsToRate(STRIPE_FEE_BPS)) + STRIPE_FEE_FIXED_CENTS;
}

// ---------------------------------------------------------------------------
// Tier selection
// ---------------------------------------------------------------------------
//
// A tier can be in one of four statuses (see migration 20260907):
//   - 'active'      : visible + buyable
//   - 'hidden'      : not shown at all
//   - 'sold_out'    : shown, disabled with "sold out" label
//   - 'access_code' : hidden until buyer submits a code from access_codes[]
//
// The legacy `is_active` boolean is still respected (is_active=false is
// treated as hidden). New rows should set status instead.

// True when a tier's status permits selling AND it has stock left. A tier
// with quantity=null is unlimited; a tier that has hit its quantity behaves
// exactly like status='sold_out' (skipped for active selection, but still
// rendered with a "sold out" badge on the buyer page).
function tierIsBuyable(t) {
  if (!t) return false;
  if (t.is_active === false) return false;
  const s = t.status || 'active';
  if (s !== 'active') return false;
  if (typeof t.quantity === 'number') {
    const remaining = t.quantity - (t.sold_count || 0) - (t.reserved_count || 0);
    if (remaining <= 0) return false;
  }
  return true;
}

function tierIsVisibleForCode(t, unlockedCodes) {
  if (!t) return false;
  if (t.is_active === false) return false;
  const s = t.status || 'active';
  if (s === 'active' || s === 'sold_out') return true;
  if (s === 'hidden') return false;
  if (s === 'access_code') {
    const codes = (t.access_codes || []).map((c) => String(c || '').trim().toUpperCase()).filter(Boolean);
    const unlocked = (unlockedCodes || []).map((c) => String(c || '').trim().toUpperCase());
    return codes.some((c) => unlocked.includes(c));
  }
  return false;
}

// Pick the tier a buyer can purchase *right now*. Windowed by starts_at/
// ends_at when set; ordered by display_order. Only 'active' status is
// eligible (sold_out, hidden, access_code tiers never win selection).
export function selectActiveTier(tiers, { now = new Date(), unlockedCodes = [] } = {}) {
  const inWindow = (tiers || [])
    .filter(tierIsBuyable)
    .filter((t) => !t.starts_at || new Date(t.starts_at) <= now)
    .filter((t) => !t.ends_at || new Date(t.ends_at) > now)
    .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
  if (inWindow[0]) return inWindow[0];

  // Fallback: an access-code tier the buyer has unlocked. Access-code tiers
  // are still buyable — they're just gated on the code — so if none of the
  // plain-active tiers apply and the buyer has an unlocked code tier in
  // window, use that.
  const codeTiers = (tiers || [])
    .filter((t) => t && t.is_active !== false && (t.status || 'active') === 'access_code')
    .filter((t) => tierIsVisibleForCode(t, unlockedCodes))
    .filter((t) => !t.starts_at || new Date(t.starts_at) <= now)
    .filter((t) => !t.ends_at || new Date(t.ends_at) > now)
    .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
  return codeTiers[0] || null;
}

// ---------------------------------------------------------------------------
// Tier visibility on the public site
// ---------------------------------------------------------------------------
//
// Reveal rule: within a product, "later" tiers (by display_order) stay
// hidden from the public site until the currently-active tier has
// <= tier_reveal_threshold tickets remaining. This gives a scarcity ladder
// without spoiling the whole pricing sequence up front.
//
// Returns an array shaped like the input, with each row extended with:
//   { visible: bool, buyable: bool, reveal_gated: bool }
// Hidden and access-code (unless unlocked) tiers are simply filtered out.

export function projectTiersForBuyer(tiers, {
  now = new Date(),
  unlockedCodes = [],
  remainingInventory = null,
  revealThreshold = null,
} = {}) {
  const t = (tiers || []).filter((row) => row && row.is_active !== false);
  const active = selectActiveTier(t, { now, unlockedCodes });
  const activeOrder = active ? (active.display_order || 0) : Number.POSITIVE_INFINITY;

  // Reveal gate: if a threshold is set AND remaining inventory is above it,
  // only the current tier is revealed. Later tiers wait.
  const revealNextTiers =
    revealThreshold === null ||
    revealThreshold === undefined ||
    remainingInventory === null ||
    remainingInventory === undefined ||
    remainingInventory <= revealThreshold;

  return t
    .filter((row) => tierIsVisibleForCode(row, unlockedCodes))
    .map((row) => {
      const order = row.display_order || 0;
      const isLater = order > activeOrder;
      const revealGated = isLater && !revealNextTiers;
      return {
        ...row,
        visible: !revealGated,
        buyable: tierIsBuyable(row) && !isLater, // only current tier is buyable
        reveal_gated: revealGated,
      };
    });
}

// ---------------------------------------------------------------------------
// Booking fees
// ---------------------------------------------------------------------------
//
// Per-ticket fee (industry standard). Tier override wins; event default is
// the fallback. Returns cents.
export function bookingFeeForTier({ tier, event }) {
  if (tier && Number.isInteger(tier.booking_fee_cents_override)) {
    return Math.max(0, tier.booking_fee_cents_override);
  }
  if (event && Number.isInteger(event.booking_fee_cents_default)) {
    return Math.max(0, event.booking_fee_cents_default);
  }
  return 295; // $2.95 hard fallback matches the schema default.
}

// ---------------------------------------------------------------------------
// Discount code application
// ---------------------------------------------------------------------------
//
// Applied against the *subtotal* (pre-fees) for percent + amount codes.
// For 'target_total' codes, back-solves so the buyer's final total (after
// booking fee + tax on the taxable base) lands on exactly the target.
//
// Percent discounts round down so we never over-refund. Amount discounts
// clamp to subtotal so a $50-off code on a $30 order gives $30 off, not a
// negative total. Target-total discounts clamp to the full subtotal (never
// negative discount, never below zero total).
//
// Params:
//   - code:           row from ticket_discount_codes
//   - items:          [{ product_id, quantity, unit_price_cents,
//                        booking_fee_unit_cents? }]
//   - productsById:   Map(product_id -> product) — kept for API compatibility;
//                     unused today
//   - bookingFeeCents (optional): total booking fee on this cart (all lines),
//                     needed for the target_total back-solve so the tax base
//                     is right. Percent/amount codes ignore it.
//   - taxRateBps (optional): overrides the default Texas rate for the
//                     target_total back-solve.
//
// Returns { discountCents, appliedItems }.
export function applyDiscountCode({
  code,
  items,
  productsById,
  bookingFeeCents = 0,
  taxRateBps = TEXAS_SALES_TAX_RATE_BPS,
}) {
  if (!code || !code.is_active) throw new Error('DISCOUNT_INVALID');
  const now = new Date();
  if (code.starts_at && new Date(code.starts_at) > now) throw new Error('DISCOUNT_NOT_YET_ACTIVE');
  if (code.ends_at && new Date(code.ends_at) <= now) throw new Error('DISCOUNT_EXPIRED');
  if (Number.isInteger(code.max_redemptions) && code.redemptions_count >= code.max_redemptions) {
    throw new Error('DISCOUNT_EXHAUSTED');
  }

  const allowedProductIds =
    code.applies_to === 'specific'
      ? new Set((code.product_ids || []).map(String))
      : null; // null = all

  let eligibleSubtotal = 0;
  const appliedItems = [];
  for (const line of items) {
    if (allowedProductIds && !allowedProductIds.has(String(line.product_id))) continue;
    const lineSubtotal = line.unit_price_cents * line.quantity;
    eligibleSubtotal += lineSubtotal;
    appliedItems.push(line);
  }

  if (eligibleSubtotal <= 0) throw new Error('DISCOUNT_NOT_APPLICABLE');

  let discountCents;
  if (code.discount_type === 'percent') {
    const pct = Math.max(0, Math.min(100, Number(code.discount_value) || 0));
    discountCents = Math.floor((eligibleSubtotal * pct) / 100);
  } else if (code.discount_type === 'amount') {
    discountCents = Math.min(eligibleSubtotal, Math.max(0, Number(code.discount_value) || 0));
  } else if (code.discount_type === 'target_total') {
    // Back-solve: buyer's final total should equal discount_value (in cents),
    // where final total = (eligibleSubtotal - discountCents + bookingFeeCents)
    //                     + tax on that same base.
    //
    // Let base = eligibleSubtotal - discountCents + bookingFeeCents.
    // final = base * (1 + rate)   (approximate; rounding handled below)
    // => base = final / (1 + rate)
    // => discountCents = eligibleSubtotal + bookingFeeCents - base
    //
    // We compute the ideal fractional base, floor it (never over-charge the
    // promoter), then verify by recomputing tax with the same rounding rule
    // as computeTaxCents. Off-by-one from rounding is corrected by nudging
    // discountCents ±1 cent until final matches target exactly (or we bail
    // if no integer discount can hit it — rare, only when target is unreachable
    // like $19.99 against a rate whose rounding produces $20.00 or $19.98).
    const target = Math.max(0, Math.floor(Number(code.discount_value) || 0));
    const rate = bpsToRate(taxRateBps);
    // Ideal pre-tax base that produces `target` after tax.
    const idealBase = target / (1 + rate);
    const initialBase = Math.floor(idealBase);
    let candidate = eligibleSubtotal + bookingFeeCents - initialBase;
    // Nudge search: try candidate, candidate+1, candidate-1 (in that order)
    // to land the recomputed final exactly on target. Also clamp to the
    // legal range [0, eligibleSubtotal].
    const attempts = [candidate, candidate + 1, candidate - 1, candidate + 2, candidate - 2];
    let solved = null;
    for (const d of attempts) {
      if (d < 0 || d > eligibleSubtotal) continue;
      const base = eligibleSubtotal - d + bookingFeeCents;
      const tax = computeTaxCents(base, taxRateBps);
      if (base + tax === target) { solved = d; break; }
    }
    if (solved === null) {
      // Target isn't reachable to the cent with integer discount + rounded
      // tax. Fall back to the closest integer discount that comes in AT OR
      // UNDER the target (never over) so the promoter's stated price is a
      // strict cap. This is <=1 cent off in practice.
      const clamped = Math.max(0, Math.min(eligibleSubtotal, candidate));
      const base = eligibleSubtotal - clamped + bookingFeeCents;
      const tax = computeTaxCents(base, taxRateBps);
      if (base + tax > target) {
        // Force one more cent of discount to stay under target.
        solved = Math.min(eligibleSubtotal, clamped + 1);
      } else {
        solved = clamped;
      }
    }
    discountCents = solved;
  } else {
    throw new Error('DISCOUNT_INVALID');
  }

  return { discountCents, appliedItems };
}

// ---------------------------------------------------------------------------
// Hold snapshot (subtotal + fees + optional discount)
// ---------------------------------------------------------------------------
//
// The single source of truth for what a hold row should look like. Called
// by /api/tickets/hold. Money in cents throughout.
export function computeHoldSnapshot({
  selections,
  productsById,
  activeTierByProduct,
  event = null,
  discountCode = null,
}) {
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new Error('EMPTY_SELECTION');
  }
  const items = [];
  let quantityTotal = 0;
  let subtotalCents = 0;
  let bookingFeeCents = 0;
  let currency = null;

  for (const sel of selections) {
    const qty = Number(sel.quantity);
    if (!Number.isInteger(qty) || qty <= 0) throw new Error('INVALID_QUANTITY');

    const product = productsById.get(sel.product_id);
    if (!product) throw new Error(`UNKNOWN_PRODUCT:${sel.product_id}`);
    if (product.is_active === false) throw new Error(`PRODUCT_INACTIVE:${sel.product_id}`);

    if (product.min_per_order && qty < product.min_per_order) {
      throw new Error(`BELOW_MIN_PER_ORDER:${sel.product_id}`);
    }
    if (product.max_per_order && qty > product.max_per_order) {
      throw new Error(`ABOVE_MAX_PER_ORDER:${sel.product_id}`);
    }

    const tier = activeTierByProduct.get(sel.product_id);
    if (!tier) throw new Error(`NO_ACTIVE_TIER:${sel.product_id}`);

    if (currency && tier.currency !== currency) throw new Error('CURRENCY_MISMATCH');
    currency = tier.currency;

    const lineSubtotal = tier.price_cents * qty;
    // If no event context is supplied, skip fees entirely so back-compat
    // callers (older tests, admin previews) don't get surprised by a
    // hardcoded default. In production the hold route always passes
    // `event`, so the schema-default booking fee always applies.
    const feePerTicket = event ? bookingFeeForTier({ tier, event }) : 0;
    const lineFees = feePerTicket * qty;

    items.push({
      product_id: sel.product_id,
      tier_id: tier.id,
      quantity: qty,
      unit_price_cents: tier.price_cents,
      booking_fee_unit_cents: feePerTicket,
    });
    quantityTotal += qty;
    subtotalCents += lineSubtotal;
    bookingFeeCents += lineFees;
  }

  let discountCents = 0;
  if (discountCode) {
    const { discountCents: applied } = applyDiscountCode({
      code: discountCode,
      items,
      productsById,
      bookingFeeCents,
      taxRateBps: TEXAS_SALES_TAX_RATE_BPS,
    });
    discountCents = applied;
  }

  // Texas sales tax on (subtotal - discount + booking_fee). Buyer never sees
  // Stripe's processing fee — that comes out of SDG's payout.
  const taxableBaseCents = Math.max(0, subtotalCents - discountCents) + bookingFeeCents;
  const taxCents = computeTaxCents(taxableBaseCents, TEXAS_SALES_TAX_RATE_BPS);
  const totalCents = taxableBaseCents + taxCents;

  return {
    items,
    quantityTotal,
    subtotalCents,
    bookingFeeCents,
    discountCents,
    taxCents,
    taxRateBps: TEXAS_SALES_TAX_RATE_BPS,
    totalCents,
    currency: currency || 'usd',
  };
}

// Whether a product is currently in its selling window (server-authoritative).
export function isProductOnSale(product, now = new Date()) {
  if (!product || product.is_active === false) return false;
  if (product.sales_start_at && new Date(product.sales_start_at) > now) return false;
  if (product.sales_end_at && new Date(product.sales_end_at) <= now) return false;
  return true;
}
