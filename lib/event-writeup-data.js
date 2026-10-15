// Server-side loader for the Financial Write-Up. Service-role client only.
import { computeWriteup, WRITEUP_DEFAULTS, bookingFeeFromHoldItems, organizerView, organizerViewsEqual } from './event-writeup.js';

const PAGE = 1000;

async function selectAll(query) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export async function loadEventWriteup(admin, eventId) {
  const { data: event, error } = await admin
    .from('events')
    .select('id, title, ticketing_mode, event_date, contact_id')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw error;
  if (!event) return null;
  return finish(admin, event);
}

async function finish(admin, event) {
  const orders = await selectAll(() => admin
    .from('orders')
    .select('id, status, checkout_kind, total_cents, tax_cents, refunded_cents, refunded_tax_cents, hold_id')
    .eq('event_id', event.id)
    .in('status', ['paid', 'partial_refund', 'refunded'])
    .order('created_at', { ascending: true }));

  const holdIds = [...new Set(orders.map((o) => o.hold_id).filter(Boolean))];
  const holdItems = new Map();
  for (let i = 0; i < holdIds.length; i += 200) {
    const { data, error } = await admin
      .from('ticket_holds')
      .select('id, items')
      .in('id', holdIds.slice(i, i + 200));
    if (error) throw error;
    for (const h of data || []) holdItems.set(h.id, h.items);
  }

  const counted = orders.filter((o) => o.checkout_kind !== 'comp' && o.checkout_kind !== 'save_payment_method');
  const enriched = counted.map((o) => ({
    ...o,
    booking_fee_cents: bookingFeeFromHoldItems(holdItems.get(o.hold_id)),
  }));

  // Tickets sold = active (valid/used) tickets on paid, non-comp orders.
  let ticketsSold = 0;
  const paidIds = counted.filter((o) => Number(o.total_cents) > 0).map((o) => o.id);
  for (let i = 0; i < paidIds.length; i += 200) {
    const { count, error } = await admin
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .in('order_id', paidIds.slice(i, i + 200))
      .in('status', ['valid', 'used']);
    if (error) throw error;
    ticketsSold += count || 0;
  }

  const { data: saved, error: savedErr } = await admin
    .from('event_writeups')
    .select('door_gross_cents, door_tax_bps, door_cc_fee_bps, stripe_pct_bps, stripe_fixed_cents, organizer_percent, adjustments, notes, updated_at, door_proofs, organizer_snapshot, shared_at')
    .eq('event_id', event.id)
    .maybeSingle();
  if (savedErr) throw savedErr;

  const config = {
    ...WRITEUP_DEFAULTS,
    door_gross_cents: null,
    organizer_percent: null,
    adjustments: [],
    notes: null,
    updated_at: null,
    ...(saved || {}),
  };
  if (config.organizer_percent != null) config.organizer_percent = Number(config.organizer_percent);

  const { door_proofs: rawProofs, organizer_snapshot: snapshot, shared_at: sharedAt, ...editable } = config;
  const writeup = computeWriteup({ orders: enriched, ticketsSold, config: editable });

  let organizer = null;
  if (event.contact_id) {
    const { data: c } = await admin.from('contacts').select('id, display_name').eq('id', event.contact_id).maybeSingle();
    organizer = c ? { id: c.id, name: c.display_name || 'Organizer' } : null;
  }

  const current = organizerView(writeup, event);
  return {
    event: { id: event.id, title: event.title, ticketing_mode: event.ticketing_mode, event_date: event.event_date },
    config: editable,
    writeup,
    proofs: (Array.isArray(rawProofs) ? rawProofs : []).map((p) => ({
      id: p.id, name: p.name, content_type: p.content_type, size: p.size, uploaded_at: p.uploaded_at,
    })),
    organizer,
    sharing: {
      shared: Boolean(sharedAt && snapshot),
      shared_at: sharedAt || null,
      outdated: Boolean(sharedAt && snapshot) && !organizerViewsEqual(snapshot, current),
    },
    organizerPreview: current,
  };
}

// Raw proof rows (with storage paths) for server routes only.
export async function loadProofRows(admin, eventId) {
  const { data, error } = await admin.from('event_writeups').select('door_proofs').eq('event_id', eventId).maybeSingle();
  if (error) throw error;
  return Array.isArray(data?.door_proofs) ? data.door_proofs : [];
}
