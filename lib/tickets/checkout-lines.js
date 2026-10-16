import { isEntitlementDiscountable, isRentalDiscountable } from './pricing.js';

// Only the winning discount's eligible products may change. Split quantities
// when a discounted line total cannot divide evenly into whole-cent unit prices.
// These are Stripe display lines, not inventory/hold items.
//
// An entitlement discount has two independent parts — the event's ticket
// percent on ticket lines and the fixed rental percent on private-space lines —
// so each part is allocated only across its own lines.
export function discountedCheckoutLines(snapshot, productsById, discountCode = null) {
  const discount = snapshot.discountCents || 0;
  const items = snapshot.items;
  if (!discount) return items.map(line => ({ ...line }));

  if (snapshot.discountSource === 'entitlement') {
    const hasSplit = Number.isSafeInteger(snapshot.ticketEntitlementDiscountCents)
      || Number.isSafeInteger(snapshot.rentalEntitlementDiscountCents);
    const ticketCents = hasSplit ? (snapshot.ticketEntitlementDiscountCents || 0) : discount;
    const rentalCents = hasSplit ? (snapshot.rentalEntitlementDiscountCents || 0) : 0;
    if (ticketCents + rentalCents !== discount) {
      throw new Error('Invalid checkout discount allocation');
    }
    const isTicket = line => isEntitlementDiscountable(productsById.get(line.product_id));
    const isRental = line => isRentalDiscountable(productsById.get(line.product_id));
    const ticketPass = allocate(items, isTicket, ticketCents);
    return allocate(ticketPass, line => !line.__discounted && isRental(line), rentalCents)
      .map(({ __discounted, ...line }) => line);
  }

  const allowedIds = snapshot.discountSource === 'code' && discountCode?.applies_to === 'specific'
    ? new Set((discountCode.product_ids || []).map(String)) : null;
  const eligible = line => !allowedIds || allowedIds.has(String(line.product_id));
  return allocate(items, eligible, discount).map(({ __discounted, ...line }) => line);
}

// Spread `discount` cents across the lines matching `eligible`, proportional to
// each line's subtotal. Lines it touches are tagged so a second pass skips them.
function allocate(items, eligible, discount) {
  if (!discount) return items.map(line => ({ ...line }));
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
    if (line.quantity > remainder) lines.push({ ...line, quantity: line.quantity - remainder, unit_price_cents: unit, __discounted: true });
    if (remainder) lines.push({ ...line, quantity: remainder, unit_price_cents: unit + 1, __discounted: true });
    return lines;
  });
}
