import { buildCapacityCatalogue, buildCapacityReport, operatingDate, operatingWindow, validDate } from './analytics.js';

const SESSION_FIELDS = 'id,name,max_capacity,current_count,is_active,started_at,ended_at,updated_at';
const ROW_FIELDS = 'id,session_id,action,delta,count_after,max_capacity,created_at';

// Fail closed at the safety limit instead of silently truncating a busy night.
export async function capacityPages(factory, size = 500, maxPages = 200) {
  const result = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await factory().range(page * size, (page + 1) * size - 1);
    if (error) throw new Error('Unable to read capacity reporting data');
    result.push(...(data || []));
    if ((data || []).length < size) return result;
  }
  throw new Error('Capacity reporting result is too large; no partial results were returned');
}

async function one(query) {
  const { data, error } = await query;
  if (error) throw new Error('Unable to read capacity reporting data');
  return data;
}

export async function loadCapacityAnalytics(admin, params, now = Date.now()) {
  const mode = params.get('mode') || 'catalogue';
  const interval = params.get('interval') || '60';
  if (!['5', '60'].includes(interval)) return { status: 400, error: 'Interval must be 5 or 60 minutes' };
  if (!['catalogue', 'event', 'night', 'live'].includes(mode)) return { status: 400, error: 'Invalid reporting mode' };
  if (mode === 'catalogue') {
    const events = await capacityPages(() => admin.from('events').select('id,title,event_date,status').eq('status', 'published').order('event_date', { ascending: false }).order('id'));
    const sessions = await capacityPages(() => admin.from('capacity_sessions').select(SESSION_FIELDS).order('started_at').order('id'));
    return { catalogue: buildCapacityCatalogue(events, sessions, now), fetchedAt: new Date(now).toISOString() };
  }
  let date = params.get('date'), event = null;
  if (mode === 'event') {
    const id = params.get('event');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '')) return { status: 400, error: 'Invalid event' };
    event = await one(admin.from('events').select('id,title,event_date,status').eq('id', id).eq('status', 'published').maybeSingle());
    if (!event) return { status: 404, error: 'Event not found' };
    date = event.event_date;
  }
  if (mode === 'live') date = operatingDate(now);
  if (!validDate(date)) return { status: 400, error: 'Invalid operating date' };
  const window = operatingWindow(date);
  const peers = await capacityPages(() => admin.from('events').select('id,title,event_date').eq('event_date', date).eq('status', 'published').order('id'));
  // Never duplicate an operating day's totals under several competing events.
  if (mode === 'event' && peers.length > 1) return {
    event, date, peers, ambiguous: true, fetchedAt: new Date(now).toISOString(),
    message: 'Multiple published events share this operating date. Open the shared operating-night view to inspect venue-wide history without assigning it to one event.',
  };
  const until = new Date(Math.min(now, new Date(window.end).getTime())).toISOString();
  const sessions = await capacityPages(() => admin.from('capacity_sessions').select(SESSION_FIELDS)
    .lt('started_at', until).or(`ended_at.is.null,ended_at.gt.${window.start}`).order('started_at').order('id'));
  const rows = sessions.length ? await capacityPages(() => admin.from('capacity_events').select(ROW_FIELDS)
    .in('session_id', sessions.map((s) => s.id))
    .gte('created_at', window.start).lt('created_at', until).order('created_at').order('id')) : [];
  const seeds = [];
  for (const s of sessions) {
    const seed = await one(admin.from('capacity_events').select(ROW_FIELDS).eq('session_id', s.id)
      .lt('created_at', window.start).order('created_at', { ascending: false }).order('id').limit(1).maybeSingle());
    if (seed) seeds.push(seed);
  }
  const report = buildCapacityReport({ date, sessions, rows, seeds, now, intervalMinutes: Number(interval) });
  let live = null;
  if (mode === 'live' || report.isCurrent) {
    const active = await one(admin.from('capacity_sessions').select(SESSION_FIELDS).eq('is_active', true).maybeSingle());
    const door = await one(admin.from('door_sessions').select('event_id,opened_at').is('closed_at', null).maybeSingle());
    // A stale door session is explicitly NOT an attribution rule.
    const doorIsCurrent = door && operatingDate(new Date(door.opened_at).getTime()) === date;
    let doorEvent = null;
    if (doorIsCurrent) doorEvent = await one(admin.from('events').select('id,title,event_date').eq('id', door.event_id).maybeSingle());
    live = {
      count: active?.current_count ?? null, limit: active?.max_capacity ?? null,
      sessionName: active?.name ?? null, updatedAt: active?.updated_at ?? null,
      eventTitle: doorEvent?.event_date === date ? doorEvent.title : null,
      staleDoor: Boolean(door && (!doorIsCurrent || doorEvent?.event_date !== date)),
      hasSession: Boolean(active),
    };
  }
  return { report, event, peers, live, fetchedAt: new Date(now).toISOString() };
}
