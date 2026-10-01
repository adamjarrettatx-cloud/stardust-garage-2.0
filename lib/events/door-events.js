import { computeEventStart, computeEventListingCutoff } from './is-event-listable.js';

export const DOOR_LEAD_MS = 60 * 60 * 1000;

export function doorEventWindow(event) {
  const start = computeEventStart(event);
  const end = start && computeEventListingCutoff(event);
  if (!start || !end || !Number.isFinite(end.getTime()) || end <= start) return null;
  return { opensAt: start.getTime() - DOOR_LEAD_MS, startsAt: start.getTime(), endsAt: end.getTime() };
}

export function safePublicUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// Strict projection: no share tokens, staff fields, contact details or session
// IDs ever leave this module. Re-check status/visibility even for admin reads.
export function publicDoorEvent(event, window) {
  return {
    id: event.id,
    title: event.title,
    event_date: event.event_date,
    event_time: event.event_time,
    event_end_time: event.event_end_time,
    image_url: safePublicUrl(event.image_url),
    href: `/events/${encodeURIComponent(event.slug)}`,
    ticketing_mode: event.ticketing_mode,
    ticket_url: safePublicUrl(event.ticket_url),
    starts_at: new Date(window.startsAt).toISOString(),
    ends_at: new Date(window.endsAt).toISOString(),
  };
}

// Current events win over no events, NOT over other matching events: an
// overlap without a fresh, time-matched staff session must be explicit.
export function selectDoorEvents(events, session = null, now = new Date()) {
  const nowMs = now.getTime();
  const windows = (events || [])
    .filter(e => e.status === 'published' && e.visibility === 'public' && e.slug)
    .map(event => ({ event, window: doorEventWindow(event) }))
    .filter(row => row.window);
  const candidates = windows
    .filter(({ window: w }) => nowMs >= w.opensAt && nowMs < w.endsAt)
    .sort((a, b) => a.window.startsAt - b.window.startsAt || a.event.id.localeCompare(b.event.id));
  const opened = Date.parse(session?.opened_at);
  const staffChoice = session && !session.closed_at && candidates.find(({ event, window }) =>
    event.id === session.event_id && opened >= window.opensAt && opened <= nowMs);
  const selected = staffChoice ? [staffChoice] : candidates;
  const next = windows.flatMap(({ window: w }) => [w.opensAt, w.startsAt, w.endsAt]).filter(t => t > nowMs);
  return {
    state: selected.length === 0 ? 'empty' : selected.length === 1 ? 'current' : 'choose',
    events: selected.map(({ event, window }) => publicDoorEvent(event, window)),
    server_now: now.toISOString(),
    next_change_at: next.length ? new Date(Math.min(...next)).toISOString() : null,
  };
}
