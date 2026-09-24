import { isEventStillListable } from '../events/is-event-listable.js';

export function isUsableTicket(ticket) {
  return ticket.status === 'valid' || ticket.status === 'active';
}

// A single event tile opens every owned order/ticket for that event. Never
// discard history; a mixed used/valid purchase stays in the upcoming group.
export function buildTicketEventGrid(orders, now = new Date()) {
  const groups = new Map();
  for (const order of orders || []) {
    const id = order.event_id || order.event?.id || `order:${order.id}`;
    if (!groups.has(id)) groups.set(id, { id, event: order.event || null, orders: [], tickets: [], purchasedAt: '' });
    const group = groups.get(id);
    group.orders.push(order);
    group.tickets.push(...(order.tickets || []).map((ticket) => ({ ...ticket, orderId: order.id })));
    if ((order.paid_at || order.created_at || '') > group.purchasedAt) group.purchasedAt = order.paid_at || order.created_at;
  }
  const result = [...groups.values()].map((group) => {
    const dated = /^\d{4}-\d{2}-\d{2}$/.test(group.event?.event_date || '');
    const past = dated && !isEventStillListable(group.event, now);
    const allInactive = group.tickets.length > 0 && group.tickets.every((ticket) => !isUsableTicket(ticket));
    const allUsed = group.tickets.length > 0 && group.tickets.every((ticket) => ticket.status === 'used');
    const refunded = group.orders.every((order) => order.status === 'refunded');
    const archived = past || allInactive || refunded;
    return { ...group, archived, past, muted: allInactive || refunded, state: allUsed ? 'Used' : refunded ? 'Refunded' : past ? 'Past event' : allInactive ? 'Inactive tickets' : dated ? 'Upcoming event' : 'Date unavailable' };
  });
  return result.sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    const aDate = a.event?.event_date || '';
    const bDate = b.event?.event_date || '';
    if (aDate && bDate && aDate !== bDate) return a.archived ? bDate.localeCompare(aDate) : aDate.localeCompare(bDate);
    if (Boolean(aDate) !== Boolean(bDate)) return aDate ? -1 : 1;
    return b.purchasedAt.localeCompare(a.purchasedAt) || a.id.localeCompare(b.id);
  });
}
