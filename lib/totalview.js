// ---------------------------------------------------------------------------
// TotalView — pure helpers
// ---------------------------------------------------------------------------
// TotalView (/bananas/totalview) is the one-page overview of the whole back
// office. The server loader (lib/totalview-data.js) reads raw rows once and
// these dependency-free helpers turn them into the numbers each time frame
// shows. Keeping the math here means it can be unit-tested without Supabase
// and the client never has to receive thousands of raw timestamps.
//
// One time-frame switch drives both directions:
//   * "Coming up · next X"  — events, tasks, bookings and shifts ahead
//   * "What happened · last X" — activity, compared with the X before it

export const TOTALVIEW_TIMEZONE = 'America/Chicago';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const TOTALVIEW_RANGES = [
  { id: '24h', label: '24 hrs', ms: 24 * HOUR_MS, next: 'next 24 hrs', last: 'last 24 hrs', span: '24 hrs' },
  { id: '72h', label: '72 hrs', ms: 72 * HOUR_MS, next: 'next 72 hrs', last: 'last 72 hrs', span: '72 hrs' },
  { id: '7d', label: '7 days', ms: 7 * DAY_MS, next: 'next 7 days', last: 'last 7 days', span: '7 days' },
  { id: '30d', label: '30 days', ms: 30 * DAY_MS, next: 'next 30 days', last: 'last 30 days', span: '30 days' },
  { id: '90d', label: '90 days', ms: 90 * DAY_MS, next: 'next 90 days', last: 'last 90 days', span: '90 days' },
];

// Owner decision 2026-10-17: the page opens on 72 hrs.
export const DEFAULT_TOTALVIEW_RANGE = '72h';

// The longest window decides how far back the loader must read: the largest
// range plus the equal period before it, so the comparison is always complete.
export const TOTALVIEW_LOOKBACK_MS = 2 * Math.max(...TOTALVIEW_RANGES.map((r) => r.ms));
export const TOTALVIEW_LOOKAHEAD_MS = Math.max(...TOTALVIEW_RANGES.map((r) => r.ms));

export const SPARK_BUCKETS = 12;

export function resolveTotalViewRange(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const match = TOTALVIEW_RANGES.find((r) => r.id === raw);
  return match ? match.id : DEFAULT_TOTALVIEW_RANGE;
}

export function totalViewRange(id) {
  return TOTALVIEW_RANGES.find((r) => r.id === id) || TOTALVIEW_RANGES.find((r) => r.id === DEFAULT_TOTALVIEW_RANGE);
}

// YYYY-MM-DD for an instant in Austin, so date-only columns (event_date,
// due_date, booking_date) compare against the venue's calendar day.
export function austinDate(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TOTALVIEW_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

function toMs(value) {
  if (value == null) return NaN;
  if (typeof value === 'number') return value;
  return Date.parse(value);
}

// Points are { at, weight }. Weight defaults to 1 so a plain list of
// timestamps counts rows. Returns { value, prior, series } for one window.
export function windowStats(points, nowMs, rangeMs, buckets = SPARK_BUCKETS) {
  const start = nowMs - rangeMs;
  const priorStart = start - rangeMs;
  const bucketMs = rangeMs / buckets;
  const series = new Array(buckets).fill(0);
  let value = 0;
  let prior = 0;
  for (const point of points || []) {
    const at = toMs(point?.at ?? point);
    if (!Number.isFinite(at) || at > nowMs || at < priorStart) continue;
    const weight = Number.isFinite(point?.weight) ? point.weight : 1;
    if (at >= start) {
      value += weight;
      const index = Math.min(buckets - 1, Math.floor((at - start) / bucketMs));
      series[index] += weight;
    } else {
      prior += weight;
    }
  }
  return { value, prior, series };
}

// Every range for one metric, keyed by range id. `available: false` lets the
// client print a dash instead of a misleading zero when a source failed.
export function metricAcrossRanges(points, nowMs, { available = true } = {}) {
  return Object.fromEntries(
    TOTALVIEW_RANGES.map((range) => [
      range.id,
      available ? windowStats(points, nowMs, range.ms) : { value: null, prior: null, series: [] },
    ])
  );
}

// Plain-language comparison. Small numbers read better as "+3" than "+300%".
export function describeChange(value, prior) {
  if (value == null || prior == null) return { text: '', direction: 'flat' };
  const diff = value - prior;
  if (diff === 0) return { text: 'No change', direction: 'flat' };
  const direction = diff > 0 ? 'up' : 'down';
  if (prior < 10) {
    return { text: `${diff > 0 ? '+' : '−'}${Math.abs(Math.round(diff)).toLocaleString('en-US')}`, direction };
  }
  const pct = Math.round((diff / prior) * 100);
  if (pct === 0) return { text: 'About the same', direction: 'flat' };
  return { text: `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`, direction };
}

// The last calendar day (Austin) that falls inside "next X".
export function lastDateInWindow(nowMs, rangeMs) {
  return austinDate(nowMs + rangeMs);
}

// Date-only rows inside today..end-of-window. Used for events and tasks.
export function withinDateWindow(dateStr, nowMs, rangeMs) {
  if (!dateStr) return false;
  const today = austinDate(nowMs);
  return dateStr >= today && dateStr <= lastDateInWindow(nowMs, rangeMs);
}

export function withinTimeWindow(value, nowMs, rangeMs) {
  const at = toMs(value);
  return Number.isFinite(at) && at >= nowMs && at <= nowMs + rangeMs;
}

// Event status label shown on the row. Mirrors the Events list badges:
// draft wins, then Secret (unlisted), then Internal, otherwise Live.
export function eventStatusLabel(event) {
  if (!event) return 'live';
  if (event.status === 'draft') return 'draft';
  if (event.visibility === 'unlisted') return 'secret';
  if (event.visibility === 'internal') return 'internal';
  return 'live';
}

// Whether a missing contract should count as attention. Internal events
// (micro parties, team-only) never carry a performer/organizer contract.
export function eventNeedsContract(event) {
  return Boolean(event) && event.visibility !== 'internal';
}

// Whole days a due date is behind today (positive = late).
export function daysLate(dueDate, nowMs) {
  if (!dueDate) return 0;
  const today = Date.parse(`${austinDate(nowMs)}T00:00:00Z`);
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  if (!Number.isFinite(today) || !Number.isFinite(due)) return 0;
  return Math.round((today - due) / DAY_MS);
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// Shift hours as weighted points at the shift start, so "hours logged" can use
// the same window math as every other metric.
export function shiftHourPoints(shifts) {
  return (shifts || [])
    .map((s) => {
      const start = toMs(s.started_at);
      const end = toMs(s.ended_at);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      return { at: start, weight: (end - start) / HOUR_MS };
    })
    .filter(Boolean);
}
