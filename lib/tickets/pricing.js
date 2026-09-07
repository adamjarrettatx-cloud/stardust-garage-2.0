// Small pure helpers for pricing math + tier resolution.
//
// Kept dependency-free so they're trivially unit-testable. Everything here
// is server-authoritative — the client can compute the same numbers for a
// preview, but the server never trusts client-provided prices.

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
// Applied against the *subtotal* (pre-fees). Percent discounts round down
// so we never over-refund. Amount discounts clamp to subtotal so a $50
// off code on a $30 order gives $30 off, not a negative total.
//
// Returns { discountCents, appliedItems } where appliedItems is the subset
// of lines the discount actually applies to (used for auditing).
export function applyDiscountCode({ code, items, productsById }) {
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
    });
    discountCents = applied;
  }

  const totalCents = Math.max(0, subtotalCents - discountCents) + bookingFeeCents;

  return {
    items,
    quantityTotal,
    subtotalCents,
    bookingFeeCents,
    discountCents,
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
