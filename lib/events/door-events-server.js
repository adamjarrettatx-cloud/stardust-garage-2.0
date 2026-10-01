// Server-only read model. Caller supplies a service client; every query and
// returned field is constrained to published PUBLIC events. No DB writes.
import { selectDoorEvents } from './door-events.js';
import { isProductOnSale, selectActiveTier } from '../tickets/pricing.js';

export const DOOR_CACHE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
};

export function doorTicketStatus(products, tiers, inventory, now) {
  const active = products.filter(p => p.is_active !== false);
  if (!active.length) return 'unavailable';
  const inWindow = active.filter(p => isProductOnSale(p, now));
  if (!inWindow.length) {
    return active.every(p => p.sales_end_at && new Date(p.sales_end_at) <= now) ? 'closed' : 'options';
  }
  const stock = p => {
    const inv = inventory.find(i => i.product_id === p.id);
    return !inv || typeof inv.capacity !== 'number' || inv.capacity - (inv.sold || 0) - (inv.reserved || 0) > 0;
  };
  if (inWindow.some(p => stock(p) && selectActiveTier(tiers.filter(t => t.product_id === p.id), { now }))) {
    return 'available';
  }
  const soldOut = p => {
    if (!stock(p)) return true;
    const visible = tiers.filter(t => t.product_id === p.id && t.is_active !== false && t.status !== 'hidden');
    return visible.length > 0 && visible.every(t =>
      t.status === 'sold_out' ||
      (typeof t.quantity === 'number' && t.quantity - (t.sold_count || 0) - (t.reserved_count || 0) <= 0));
  };
  return inWindow.every(soldOut) ? 'sold_out' : 'options';
}

export async function loadDoorEvents(admin, { now = new Date(), ticketingEnabled = false } = {}) {
  // UTC +/- 2 days covers yesterday's overnight show and tomorrow's pre-open
  // window across Chicago's DST offsets. Never rely on the host's timezone.
  const from = new Date(now.getTime() - 2 * 86400000).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 2 * 86400000).toISOString().slice(0, 10);
  const { data: events, error } = await admin.from('events')
    .select('id,title,slug,event_date,event_time,event_end_time,image_url,ticketing_mode,ticket_url,status,visibility')
    .eq('status', 'published').eq('visibility', 'public')
    .gte('event_date', from).lte('event_date', to)
    .order('event_date', { ascending: true }).limit(101);
  if (error || !events || events.length > 100) throw new Error('Door event lookup unavailable');
  let result = selectDoorEvents(events, null, now);
  if (result.state === 'choose') {
    const { data: sessions, error: sessionError } = await admin.from('door_sessions')
      .select('event_id,opened_at,closed_at').is('closed_at', null)
      .order('opened_at', { ascending: false }).limit(1);
    // An unavailable staff hint must not cause a guess. Explicit choice is safe.
    if (!sessionError) result = selectDoorEvents(events, sessions?.[0] || null, now);
  }
  const ids = result.events.filter(e => e.ticketing_mode === 'internal').map(e => e.id);
  let products = [], tiers = [], inventory = [], unavailable = false;
  if (ticketingEnabled && ids.length) {
    const p = await admin.from('ticket_products')
      .select('id,event_id,is_active,sales_start_at,sales_end_at')
      .in('event_id', ids).eq('is_active', true);
    unavailable = !!p.error || !p.data;
    products = p.data || [];
    const productIds = products.map(p => p.id);
    if (!unavailable && productIds.length) {
      const t = await admin.from('ticket_price_tiers')
        .select('product_id,is_active,status,starts_at,ends_at,display_order,quantity,sold_count,reserved_count')
        .in('product_id', productIds);
      const i = await admin.from('ticket_inventory')
        .select('product_id,capacity,sold,reserved').in('product_id', productIds);
      unavailable = !!t.error || !!i.error || !t.data || !i.data;
      tiers = t.data || []; inventory = i.data || [];
    }
  }
  result.events = result.events.map(event => ({
    ...event,
    ticket_status: event.ticketing_mode === 'none' ? 'free'
      : event.ticketing_mode !== 'internal' ? (event.ticket_url ? 'external' : 'unavailable')
      : !ticketingEnabled || unavailable ? 'unavailable'
      : doorTicketStatus(products.filter(p => p.event_id === event.id), tiers, inventory, now),
  }));
  return result;
}
