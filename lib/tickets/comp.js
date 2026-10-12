import { generateHoldToken, generateTicketCode } from '@/lib/tickets/codes';

// Admin-issued complimentary tickets.
//
// A comp is a $0 order that reserves and sells inventory through the same
// create_ticket_hold / consume_ticket_hold functions used by paid checkout,
// so capacity is enforced atomically and the product's sold count stays in
// ticket_inventory. Comps are product-level only: they never consume a price
// tier's quantity, so comping a guest cannot close a paid tier early.
//
// Idempotency: the caller sends a comp_ref (one per form submission). The
// unique index on orders(event_id, comp_ref) means a double-click or a retry
// of the same submission returns the first order instead of issuing twice.

export const COMP_MAX_QUANTITY = 20;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CompError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function validateCompRequest(body) {
  const b = body || {};
  const eventId = String(b.event_id || '');
  const productId = String(b.product_id || '');
  const email = String(b.buyer_email || '').trim().toLowerCase();
  const name = String(b.buyer_name || '').trim().slice(0, 200) || null;
  const note = String(b.note || '').trim().slice(0, 500);
  const compRef = String(b.comp_ref || '').trim().slice(0, 100);
  const quantity = Number(b.quantity);
  if (!UUID.test(eventId) || !UUID.test(productId)) throw new CompError('Choose a ticket type.');
  if (!EMAIL.test(email) || email.length > 254) throw new CompError('Enter a valid recipient email.');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > COMP_MAX_QUANTITY) {
    throw new CompError(`Quantity must be between 1 and ${COMP_MAX_QUANTITY}.`);
  }
  if (!note) throw new CompError('Enter a reason for the comp.');
  if (!compRef) throw new CompError('Missing submission reference. Reload and try again.');
  return {
    eventId, productId, email, name, note, compRef, quantity,
    sendEmail: b.send_email !== false,
  };
}

async function findExisting(db, eventId, compRef) {
  const { data, error } = await db.from('orders')
    .select('id, status').eq('event_id', eventId).eq('comp_ref', compRef).maybeSingle();
  if (error) throw error;
  return data;
}

// Creates the comp order and tickets. Returns { order, tickets, product, deduped }.
export async function issueComp(db, input, actorUserId) {
  const { eventId, productId, email, name, note, compRef, quantity } = input;

  const { data: product, error: productError } = await db.from('ticket_products')
    .select('id, event_id, name, kind').eq('id', productId).maybeSingle();
  if (productError) throw productError;
  if (!product || product.event_id !== eventId) throw new CompError('That ticket type is not part of this event.');
  if (product.kind !== 'tickets') throw new CompError('Comps can only be issued for admission tickets.');

  const prior = await findExisting(db, eventId, compRef);
  if (prior) return { order: prior, tickets: [], product, deduped: true };

  // 1. Claim the comp_ref with a pending order before touching inventory.
  const nowIso = new Date().toISOString();
  const inserted = await db.from('orders').insert({
    event_id: eventId,
    buyer_email: email,
    buyer_name: name,
    status: 'pending',
    subtotal_cents: 0,
    total_cents: 0,
    currency: 'usd',
    checkout_kind: 'comp',
    comp_ref: compRef,
    created_by_user_id: actorUserId,
    raw_metadata: { comp: true, note },
  }).select('*').single();
  if (inserted.error) {
    if (String(inserted.error.code) === '23505') {
      const winner = await findExisting(db, eventId, compRef);
      if (winner) return { order: winner, tickets: [], product, deduped: true };
    }
    throw inserted.error;
  }
  const order = inserted.data;

  // Anything that fails before tickets exist removes the pending order so the
  // admin can resubmit cleanly.
  async function abandon(holdId) {
    if (holdId) await db.rpc('release_ticket_hold', { p_hold_id: holdId });
    await db.from('orders').delete().eq('id', order.id).eq('status', 'pending');
  }

  // 2. Reserve and sell inventory atomically (NULL capacity = unlimited).
  const items = [{ product_id: productId, tier_id: null, quantity, unit_price_cents: 0 }];
  const { data: holdId, error: holdError } = await db.rpc('create_ticket_hold', {
    p_event_id: eventId,
    p_hold_token: generateHoldToken(),
    p_items: items,
    p_quantity_total: quantity,
    p_subtotal_cents: 0,
    p_currency: 'usd',
    p_user_id: null,
    p_member_profile_id: null,
    p_buyer_email: email,
    p_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
  if (holdError) {
    await abandon(null);
    if (String(holdError.message || '').includes('INVENTORY_UNAVAILABLE')) {
      throw new CompError('Not enough tickets left for that ticket type.', 409);
    }
    throw holdError;
  }
  const { data: consumed, error: consumeError } = await db.rpc('consume_ticket_hold', { p_hold_id: holdId });
  if (consumeError || !consumed) {
    await abandon(holdId);
    throw consumeError || new CompError('Could not reserve tickets. Try again.', 409);
  }

  // 3. Order item + tickets. Inventory is already sold at this point, so a
  //    failure here voids the order (keeping the audit trail) instead of
  //    silently deleting it.
  try {
    const item = await db.from('order_items').insert({
      order_id: order.id,
      product_id: productId,
      tier_id: null,
      product_name_snapshot: product.name,
      tier_name_snapshot: 'Comp',
      quantity,
      unit_price_cents: 0,
      subtotal_cents: 0,
    }).select('id').single();
    if (item.error) throw item.error;

    const rows = () => Array.from({ length: quantity }, (_, seat) => ({
      order_id: order.id,
      order_item_id: item.data.id,
      event_id: eventId,
      product_id: productId,
      seat_index: seat,
      ticket_code: generateTicketCode(),
      status: 'valid',
    }));
    let issued = await db.from('tickets').insert(rows()).select('id, ticket_code');
    if (issued.error && String(issued.error.code) === '23505' && /ticket_code/.test(issued.error.message || '')) {
      issued = await db.from('tickets').insert(rows()).select('id, ticket_code');
    }
    if (issued.error) throw issued.error;

    const paid = await db.from('orders')
      .update({ status: 'paid', paid_at: nowIso, hold_id: holdId })
      .eq('id', order.id).select('*').single();
    if (paid.error) throw paid.error;

    await db.from('ticket_audit_log').insert({
      event_id: eventId,
      order_id: order.id,
      actor_user_id: actorUserId,
      actor_role: 'admin',
      action: 'ticket.comp',
      detail: { product_id: productId, product_name: product.name, quantity, buyer_email: email, buyer_name: name, note },
    });

    return { order: paid.data, tickets: issued.data, product, deduped: false };
  } catch (err) {
    await db.from('orders').update({ status: 'void', cancel_reason: 'comp_issue_failed' }).eq('id', order.id);
    await db.from('tickets').update({ status: 'void', voided_at: nowIso }).eq('order_id', order.id);
    // Return the seats consume_ticket_hold already counted as sold.
    const { data: inv } = await db.from('ticket_inventory').select('sold').eq('product_id', productId).maybeSingle();
    if (inv) {
      await db.from('ticket_inventory')
        .update({ sold: Math.max(0, (inv.sold || 0) - quantity), updated_at: nowIso })
        .eq('product_id', productId);
    }
    await db.from('ticket_audit_log').insert({
      event_id: eventId, order_id: order.id, actor_user_id: actorUserId, actor_role: 'admin',
      action: 'ticket.comp_failed', detail: { error: String(err?.message || err), quantity, product_id: productId },
    });
    throw err;
  }
}
