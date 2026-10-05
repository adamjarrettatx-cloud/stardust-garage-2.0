// Online ticket sales for the event a door session is running.
//
// The front desk uses this to know how many pre-sold guests to expect. The
// number is "online sales" in the plain door sense: paid tickets that are
// still good (valid = not yet scanned, used = already scanned). Refunded and
// voided tickets are excluded. Comp tickets are counted separately because
// nobody bought them, but the door should still expect those guests.
//
// Events still on TicketTailor have no local ticket rows, so for those we
// fall back to the cached event_ticket_metrics snapshot (tickets_sold only;
// no arrival split is available from that source).

const LIVE_TICKET_STATUSES = ['valid', 'used'];

export async function getOnlineSalesForEvent(admin, eventId) {
  const { data: event } = await admin
    .from('events')
    .select('id, ticketing_mode')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) return null;

  const { data: tickets, error } = await admin
    .from('tickets')
    .select('status, order:orders!inner(status, checkout_kind)')
    .eq('event_id', eventId)
    .in('status', LIVE_TICKET_STATUSES);
  if (error) throw new Error('ticket lookup failed');

  let sold = 0;
  let soldScanned = 0;
  let comps = 0;
  let compsScanned = 0;
  for (const t of tickets || []) {
    const orderStatus = t.order?.status;
    if (orderStatus !== 'paid' && orderStatus !== 'partial_refund') continue;
    const scanned = t.status === 'used';
    if (t.order?.checkout_kind === 'comp') {
      comps += 1;
      if (scanned) compsScanned += 1;
    } else {
      sold += 1;
      if (scanned) soldScanned += 1;
    }
  }

  if (sold + comps === 0 && event.ticketing_mode === 'tickettailor') {
    const { data: metrics } = await admin
      .from('event_ticket_metrics')
      .select('tickets_sold, fetched_at')
      .eq('event_id', eventId)
      .maybeSingle();
    if (metrics) {
      return {
        source: 'tickettailor',
        sold: metrics.tickets_sold || 0,
        sold_scanned: null,
        comps: 0,
        comps_scanned: 0,
        as_of: metrics.fetched_at || null,
      };
    }
  }

  return {
    source: 'internal',
    sold,
    sold_scanned: soldScanned,
    comps,
    comps_scanned: compsScanned,
    as_of: new Date().toISOString(),
  };
}
