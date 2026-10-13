// Read-only roster helpers. Never infer a person's name from an email address.
export function purchaserName(order, profiles = []) {
  const savedName = order.buyer_name?.trim();
  if (savedName) return savedName;
  const profile = profiles.find((p) => p.id === order.member_profile_id)
    || profiles.find((p) => order.user_id && p.user_id === order.user_id);
  return profile?.full_name?.trim() || null;
}

export function assembleRoster(orders, tickets, attendees, items, profiles) {
  const attendeesById = new Map(attendees.map((a) => [a.id, a]));
  const attendeesByTicket = new Map(attendees.filter((a) => a.ticket_id).map((a) => [a.ticket_id, a]));
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const ticketsByOrder = new Map();
  for (const ticket of tickets) {
    const attendee = attendeesById.get(ticket.attendee_id) || attendeesByTicket.get(ticket.id);
    const item = itemsById.get(ticket.order_item_id);
    const row = {
      id: ticket.id,
      status: ticket.status,
      used_at: ticket.used_at,
      attendee_name: attendee?.full_name?.trim() || null,
      attendee_email: attendee?.email || null,
      product_name: item?.product_name_snapshot || 'Ticket',
      tier_name: item?.tier_name_snapshot || null,
    };
    if (!ticketsByOrder.has(ticket.order_id)) ticketsByOrder.set(ticket.order_id, []);
    ticketsByOrder.get(ticket.order_id).push(row);
  }
  return orders.map((order) => ({
    id: order.id,
    buyer_name: purchaserName(order, profiles),
    buyer_email: order.buyer_email,
    status: order.status,
    total_cents: order.total_cents,
    refunded_cents: order.refunded_cents,
    event_id: order.event_id,
    event_title: order.events?.title || null,
    event_date: order.events?.event_date || null,
    can_refund: Boolean(order.stripe_payment_intent_id)
      && ['paid', 'partial_refund'].includes(order.status)
      && Number(order.total_cents) > Number(order.refunded_cents || 0),
    currency: order.currency,
    is_comp: order.checkout_kind === 'comp',
    purchased_at: order.paid_at || order.created_at,
    tickets: ticketsByOrder.get(order.id) || [],
  }));
}

export function rosterTickets(orders) {
  return orders.flatMap((order) => order.tickets.map((ticket) => ({
    ...ticket,
    buyer_name: order.buyer_name,
    buyer_email: order.buyer_email,
    order_id: order.id,
    order_status: order.status,
    event_id: order.event_id,
    event_title: order.event_title,
  })));
}

export function matchesRosterSearch(row, search) {
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = [row.buyer_name, row.buyer_email, row.attendee_name, row.attendee_email, row.id, row.order_id, row.event_title]
    .filter(Boolean).join(' ').toLocaleLowerCase();
  return terms.every((term) => text.includes(term));
}

export function rosterCsv(headers, rows) {
  const cell = (value) => {
    let text = String(value ?? '');
    // Prevent customer-controlled names/emails from becoming spreadsheet formulas.
    if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
}

// Supabase caps individual result sets. Range every collection, including
// child tickets, so larger events do not silently lose people.
export async function readRosterRows(queryFactory, size = 500) {
  const all = [];
  for (let start = 0; ; start += size) {
    const { data, error } = await queryFactory().range(start, start + size - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < size) return all;
  }
}

// Column sorting for the Attendees & Orders / Orders & Refunds tables.
// Missing values always sort last in both directions; ties keep the
// server order (newest purchase first) because Array#sort is stable.
const text = (value) => (value ?? '').toString().trim().toLocaleLowerCase() || null;
const used = (order) => order.tickets.filter((t) => t.status === 'used').length;
export const ROSTER_SORTS = {
  purchasers: {
    purchaser: (o) => text(o.buyer_name) ?? text(o.buyer_email),
    event: (o) => (o.event_date || o.event_title ? `${o.event_date || ''} ${text(o.event_title) || ''}` : null),
    status: (o) => text(o.status),
    tickets: (o) => o.tickets.length,
    checked_in: (o) => used(o) + (o.tickets.length ? used(o) / o.tickets.length / 1000 : 0),
    total: (o) => Number(o.total_cents || 0),
  },
  tickets: {
    attendee: (t) => text(t.attendee_name) ?? text(t.buyer_name) ?? text(t.attendee_email) ?? text(t.buyer_email),
    event: (t) => text(t.event_title),
    type: (t) => (t.product_name ? `${text(t.product_name)} ${text(t.tier_name) || ''}` : null),
    status: (t) => text(t.status),
    checked_in: (t) => (t.used_at ? Date.parse(t.used_at) : null),
    order: (t) => text(t.order_status),
  },
};

export function sortRoster(rows, tab, key, dir = 'asc') {
  const read = ROSTER_SORTS[tab]?.[key];
  if (!read) return rows;
  const sign = dir === 'desc' ? -1 : 1;
  return rows.map((row) => [row, read(row)]).sort(([, a], [, b]) => {
    if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
    if (b === null || b === undefined) return -1;
    const cmp = typeof a === 'number' && typeof b === 'number'
      ? a - b : String(a).localeCompare(String(b), 'en-US', { numeric: true });
    return cmp * sign;
  }).map(([row]) => row);
}
