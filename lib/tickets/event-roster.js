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
    currency: order.currency,
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
  })));
}

export function matchesRosterSearch(row, search) {
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = [row.buyer_name, row.buyer_email, row.attendee_name, row.attendee_email, row.id, row.order_id]
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
