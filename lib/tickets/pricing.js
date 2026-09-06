// Small pure helpers for pricing math + tier resolution. Kept dependency-
// free so they're trivially unit-testable.

// Pick the active tier for a product "now". Tiers are ordered by
// display_order asc so admins can prioritize a promo-code tier over the
// default. A row with no start/end is treated as "always active".
export function selectActiveTier(tiers, { now = new Date() } = {}) {
  const active = (tiers || [])
    .filter((t) => t && t.is_active !== false)
    .filter((t) => !t.starts_at || new Date(t.starts_at) <= now)
    .filter((t) => !t.ends_at || new Date(t.ends_at) > now)
    .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
  return active[0] || null;
}

// Compute the hold snapshot from an array of {product_id, quantity} lines
// plus resolved products + active tiers. Throws if any line is invalid so
// the caller can 400 the request. Money in minor units (cents).
export function computeHoldSnapshot({ selections, productsById, activeTierByProduct }) {
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new Error('EMPTY_SELECTION');
  }
  const items = [];
  let quantityTotal = 0;
  let subtotalCents = 0;
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
    items.push({
      product_id: sel.product_id,
      tier_id: tier.id,
      quantity: qty,
      unit_price_cents: tier.price_cents,
    });
    quantityTotal += qty;
    subtotalCents += lineSubtotal;
  }

  return { items, quantityTotal, subtotalCents, currency: currency || 'usd' };
}

// Whether a product is currently in its selling window (server-authoritative).
export function isProductOnSale(product, now = new Date()) {
  if (!product || product.is_active === false) return false;
  if (product.sales_start_at && new Date(product.sales_start_at) > now) return false;
  if (product.sales_end_at && new Date(product.sales_end_at) <= now) return false;
  return true;
}
