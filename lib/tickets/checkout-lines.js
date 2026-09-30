import { isEntitlementDiscountable } from './pricing.js';

// Only the winning discount's eligible products may change. Split quantities
// when a discounted line total cannot divide evenly into whole-cent unit prices.
// These are Stripe display lines, not inventory/hold items.
export function discountedCheckoutLines(snapshot, productsById, discountCode = null) {
  const discount = snapshot.discountCents || 0;
  const items = snapshot.items;
  if (!discount) return items.map(line => ({ ...line }));
  const allowedIds = snapshot.discountSource === 'code' && discountCode?.applies_to === 'specific'
    ? new Set((discountCode.product_ids || []).map(String)) : null;
  const eligible = line => snapshot.discountSource === 'entitlement'
    ? isEntitlementDiscountable(productsById.get(line.product_id))
    : !allowedIds || allowedIds.has(String(line.product_id));
  const base = items.reduce((sum, line) => sum + (eligible(line) ? line.unit_price_cents * line.quantity : 0), 0);
  if (!Number.isSafeInteger(discount) || discount < 0 || discount > base) {
    throw new Error('Invalid checkout discount allocation');
  }
  let cumulativeBase = 0;
  let allocated = 0;
  return items.flatMap(line => {
    if (!eligible(line)) return [{ ...line }];
    const subtotal = line.unit_price_cents * line.quantity;
    cumulativeBase += subtotal;
    // Cumulative proportional allocation conserves every cent without dumping
    // a large remainder onto a potentially small final line.
    const cumulativeDiscount = Number(BigInt(cumulativeBase) * BigInt(discount) / BigInt(base));
    const lineDiscount = cumulativeDiscount - allocated;
    allocated = cumulativeDiscount;
    const net = subtotal - lineDiscount;
    const unit = Math.floor(net / line.quantity);
    const remainder = net % line.quantity;
    const lines = [];
    if (line.quantity > remainder) lines.push({ ...line, quantity: line.quantity - remainder, unit_price_cents: unit });
    if (remainder) lines.push({ ...line, quantity: remainder, unit_price_cents: unit + 1 });
    return lines;
  });
}
