// lib/wallet/get-orders.js
//
// Single source of truth for "everything a Stardust account can see in their
// ticket wallet": the orders they paid for, the line items on each, the tickets
// that materialised, and just enough event info (title, date, flyer, address)
// to render a card without a follow-up lookup.
//
// Both consumers of this shape import from here:
//
//   * app/api/wallet/orders/route.js  — mobile app + third-party callers hit
//     this JSON endpoint. Preserving its response shape verbatim is what
//     lets the mobile app upgrade Stardust-account tickets without a client
//     rewrite.
//   * app/account/tickets/page.jsx    — the web ticket hub. Server component
//     that calls this lib directly rather than round-tripping through the
//     API, so the account page renders in one Supabase read cycle.
//
// The join is deliberately done in application code (not a SQL view) so the
// service-role client can enforce the "user_id OR buyer_email" ownership
// rule identically to how RLS scopes /api/wallet/orders. Anyone who thinks
// they can push this into a view has to preserve that OR against the caller's
// canonical email — trivially easy to get wrong, hence living here.

// image_url is the flyer column on public.events — same column that the
// public events grid and EventDetail render. There is no separate flyer_url;
// see app/events/page.js and app/events/_components/EventDetail.jsx.
// NOTE: the column on public.events is `event_time`, NOT `start_time`. Using
// the wrong name here silently returns an empty array from Supabase and every
// order ends up with event: null in the wallet, which surfaces as the 'Ticket'
// fallback + no flyer in /account/tickets. Keep this select list in sync with
// the actual events schema (see supabase/schema exports).
const EVENT_SELECT = 'id, title, slug, event_date, event_time, event_end_time, image_url';

// Public venue address. Intentionally NULL — Adam does not want the street
// address surfaced on ticket emails, wallet cards, or any public artifact
// at this time. Every consumer of this value already guards on truthiness
// (`venueAddress ? ... : null`, `{venueAddress && ...}`) so setting it to
// null makes the address block disappear everywhere without further edits.
// If a real address is added back later, keep it in ONE place — here — so
// there is a single toggle.
export const STARDUST_VENUE_ADDRESS = null;

// Fetch the caller's ticket orders. `supabaseAdmin` is required (service-role
// client) because we scope by user_id/email in application code; the anon
// client would refuse rows the user "owns by email but not by user_id" until
// we backfill user_id on legacy orders.
//
// Returns { orders: [ { ...order, event, items, tickets } ] } — the SAME shape
// /api/wallet/orders/route.js returned before this refactor.
export async function getWalletOrders({ supabaseAdmin, user, limit = 100, all = false, offset = 0, complete = false }) {
  if (!user?.id) return { orders: [] };
  // The profile is the complete purchase history, not a latest-100 preview.
  // Keep the API's default response size unchanged for mobile compatibility.
  if (all) {
    const collected = [];
    for (let start = 0; ; start += 100) {
      const page = await getWalletOrders({ supabaseAdmin, user, limit: 100, offset: start, complete: true });
      collected.push(...page.orders);
      if (page.orders.length < 100) return { orders: collected };
    }
  }
  const emailLc = (user.email || '').toLowerCase();

  const orClause = emailLc
    // Quote the scalar so punctuation in an email can never become another
    // PostgREST filter inside this service-role ownership query.
    ? `user_id.eq.${user.id},buyer_email.eq.${JSON.stringify(emailLc)}`
    : `user_id.eq.${user.id}`;

  let orderQuery = supabaseAdmin
    .from('orders')
    .select('id, event_id, buyer_email, status, subtotal_cents, total_cents, refunded_cents, currency, paid_at, created_at')
    .or(orClause)
    .in('status', ['paid', 'refunded', 'partial_refund'])
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (offset) orderQuery = orderQuery.range(offset, offset + limit - 1);
  const { data: orders, error: orderError } = await orderQuery;
  if (orderError) throw new Error('Ticket orders could not be loaded.');

  const orderIds = (orders || []).map((o) => o.id);
  const eventIds = [...new Set((orders || []).map((o) => o.event_id))];

  const [items, tickets, events] = await Promise.all([
    orderIds.length
      ? readRelated(() => supabaseAdmin
          .from('order_items')
          .select('id, order_id, product_name_snapshot, tier_name_snapshot, quantity, unit_price_cents')
          .in('order_id', orderIds), complete)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? readRelated(() => supabaseAdmin
          .from('tickets')
          .select('id, order_id, order_item_id, ticket_code, status')
          .in('order_id', orderIds), complete)
      : Promise.resolve({ data: [] }),
    eventIds.length
      ? readRelated(() => supabaseAdmin
          .from('events')
          .select(EVENT_SELECT)
          .in('id', eventIds), complete)
      : Promise.resolve({ data: [] }),
  ]);
  if ([items, tickets, events].some((result) => result.error)) throw new Error('Ticket details could not be loaded.');

  const itemsByOrder = new Map();
  for (const i of items.data || []) {
    if (!itemsByOrder.has(i.order_id)) itemsByOrder.set(i.order_id, []);
    itemsByOrder.get(i.order_id).push(i);
  }
  const ticketsByOrder = new Map();
  for (const t of tickets.data || []) {
    if (!ticketsByOrder.has(t.order_id)) ticketsByOrder.set(t.order_id, []);
    ticketsByOrder.get(t.order_id).push(t);
  }
  const eventById = new Map((events.data || []).map((e) => [e.id, e]));

  return {
    orders: (orders || []).map((o) => ({
      ...o,
      event: eventById.get(o.event_id) || null,
      items: itemsByOrder.get(o.id) || [],
      tickets: ticketsByOrder.get(o.id) || [],
    })),
  };
}

async function readRelated(query, complete) {
  if (!complete) return query();
  const data = [];
  for (let offset = 0; ; offset += 500) {
    const result = await query().order('id', { ascending: true }).range(offset, offset + 499);
    if (result.error) return result;
    data.push(...(result.data || []));
    if ((result.data || []).length < 500) return { data, error: null };
  }
}
