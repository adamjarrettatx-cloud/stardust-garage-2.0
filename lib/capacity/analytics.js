// Pure, read-only capacity reporting. No credentials or database imports.
export const CAPACITY_TIMEZONE = 'America/Chicago';
const HOUR = 3600000;
const DAY = 86400000;
const localParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAPACITY_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', hourCycle: 'h23',
});
const ms = (value) => value == null ? NaN : new Date(value).getTime();
const iso = (value) => new Date(value).toISOString();

export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(ms(`${value}T00:00:00Z`))
    && iso(ms(`${value}T00:00:00Z`)).slice(0, 10) === value;
}

export function shiftDate(date, days) {
  return iso(ms(`${date}T12:00:00Z`) + days * DAY).slice(0, 10);
}

function parts(at) {
  return Object.fromEntries(localParts.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
}

export function operatingDate(at = Date.now()) {
  const p = parts(at);
  const day = `${p.year}-${p.month}-${p.day}`;
  return Number(p.hour) < 9 ? shiftDate(day, -1) : day;
}

// 9am is never an ambiguous/nonexistent DST wall time. Iterate the offset
// rather than subtracting a fixed 24h; operating days can be 23 or 25 hours.
function nineAM(date) {
  const naive = ms(`${date}T09:00:00Z`);
  let guess = naive;
  for (let i = 0; i < 3; i++) {
    const p = parts(guess);
    const rendered = ms(`${p.year}-${p.month}-${p.day}T${p.hour}:00:00Z`);
    guess += naive - rendered;
  }
  return guess;
}

export function operatingWindow(date) {
  if (!validDate(date)) throw new Error('Invalid operating date');
  return { start: iso(nineAM(date)), end: iso(nineAM(shiftDate(date, 1))) };
}

export function capacityHourLabel(at) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CAPACITY_TIMEZONE, hour: 'numeric', timeZoneName: 'short',
  }).format(new Date(at));
}

export function capacityWhen(at) {
  if (!at) return 'Not recorded';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CAPACITY_TIMEZONE, month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(at));
}

export function buildCapacityCatalogue(events, sessions, now = Date.now()) {
  const dates = new Set();
  for (const session of sessions) {
    if (!Number.isFinite(ms(session.started_at))) continue;
    let day = operatingDate(ms(session.started_at));
    const last = operatingDate(Math.min(now, ms(session.ended_at) || now) - 1);
    // Bound pathological source rows instead of silently returning partial data.
    let n = 0;
    while (day <= last) {
      if (++n > 3700) throw new Error('Capacity session exceeds supported reporting span');
      dates.add(day);
      day = shiftDate(day, 1);
    }
  }
  const published = events.filter((e) => e.status === 'published' && validDate(e.event_date));
  const byDate = new Map();
  for (const e of published) byDate.set(e.event_date, (byDate.get(e.event_date) || 0) + 1);
  return {
    events: published.map((e) => ({
      id: e.id, title: e.title, date: e.event_date,
      shared: byDate.get(e.event_date) > 1, hasSession: dates.has(e.event_date),
    })).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)),
    nights: [...dates].sort().reverse().map((date) => ({ date, eventCount: byDate.get(date) || 0 })),
    today: operatingDate(now),
  };
}

function unionDuration(intervals) {
  let total = 0, end = -Infinity;
  for (const [a, b] of intervals.sort((x, y) => x[0] - y[0])) {
    if (b > end) total += b - Math.max(a, end);
    end = Math.max(end, b);
  }
  return total;
}

// Reads may contain multiple sessions, explicit corrections, or missing audit
// anchors. Unknown occupancy remains null; an ended session is not an exit.
export function buildCapacityReport({ date, sessions = [], rows = [], seeds = [], now = Date.now() }) {
  const window = operatingWindow(date);
  const start = ms(window.start), end = Math.max(start, Math.min(ms(window.end), now));
  // The scheduled 9am rollover commits a few milliseconds after 9am. Without
  // this explicit sub-second normalization, yesterday's leftover count could
  // become today's peak for 200ms. No source rows are altered.
  const snap = (at) => Math.abs(at - start) < 1000 ? start
    : Math.abs(at - ms(window.end)) < 1000 ? ms(window.end) : at;
  const spans = new Map(sessions.map((s) => [s.id, {
    from: Math.max(start, snap(ms(s.started_at))),
    to: Math.min(end, Number.isFinite(ms(s.ended_at)) ? snap(ms(s.ended_at)) : end),
  }]));
  const records = rows.map((r) => r.action === 'start_session' && Math.abs(ms(r.created_at) - start) < 1000
    ? { ...r, created_at: window.start } : r).filter((r) => {
    const span = spans.get(r.session_id);
    return span && span.to > span.from && ms(r.created_at) >= span.from && ms(r.created_at) < span.to;
  })
    .sort((a, b) => ms(a.created_at) - ms(b.created_at) || String(a.id).localeCompare(String(b.id)));
  const warnings = [];
  const tracks = sessions.map((s) => {
    const { from, to } = spans.get(s.id);
    const seed = seeds.find((r) => r.session_id === s.id);
    const points = records.filter((r) => r.session_id === s.id);
    return { from, to, points, seed, session: s };
  }).filter((t) => t.to > t.from);
  const ties = new Set();
  for (const t of tracks) {
    for (let i = 1; i < t.points.length; i++) {
      const a = t.points[i - 1], b = t.points[i];
      if (ms(a.created_at) === ms(b.created_at) && a.count_after !== b.count_after) ties.add(`${b.session_id}:${ms(b.created_at)}`);
    }
  }
  const valueAt = (t, time) => {
    if (time < t.from || time >= t.to) return null;
    let row = t.seed || null;
    for (const p of t.points) {
      if (ms(p.created_at) > time) break;
      row = p;
    }
    if (!row || ties.has(`${row.session_id}:${ms(row.created_at)}`)) return null;
    return { count: row.count_after, max: row.max_capacity, at: row.created_at };
  };
  const buckets = [];
  for (let at = start; at < end; at += HOUR) {
    const until = Math.min(at + HOUR, end);
    const points = records.filter((r) => ms(r.created_at) >= at && ms(r.created_at) < until);
    const intervals = tracks.map((t) => [Math.max(at, t.from), Math.min(until, t.to)]).filter(([a, b]) => b > a);
    const coverageMs = unionDuration(intervals);
    const values = [];
    for (const t of tracks) {
      const carry = valueAt(t, Math.max(at, t.from));
      if (carry) values.push(carry);
    }
    for (const r of points) if (Number.isInteger(r.count_after)) values.push({ count: r.count_after, max: r.max_capacity, at: r.created_at });
    const peak = values.reduce((best, v) => !best || v.count > best.count ? v : best, null);
    const endingTracks = tracks.filter((t) => until - 0.001 >= t.from && until - 0.001 < t.to);
    const closing = endingTracks.length === 1 ? valueAt(endingTracks[0], until - 0.001) : null;
    const entries = points.filter((r) => r.action === 'check_in').reduce((n, r) => n + Math.max(0, r.delta), 0);
    const exits = points.filter((r) => r.action === 'check_out').reduce((n, r) => n + Math.max(0, -r.delta), 0);
    const corrections = points.filter((r) => ['reset', 'adjust'].includes(r.action));
    buckets.push({
      start: iso(at), end: iso(until), label: capacityHourLabel(at),
      entries: coverageMs ? entries : null, exits: coverageMs ? exits : null,
      peak: peak?.count ?? null, peakAt: peak?.at ?? null, limit: peak?.max ?? null,
      closing: closing?.count ?? null, corrections: corrections.length,
      correctionDelta: corrections.reduce((n, r) => n + r.delta, 0),
      coverage: coverageMs === 0 ? 'none' : coverageMs < until - at - 1 ? 'partial' : 'session',
      carried: points.length === 0 && Boolean(peak),
    });
  }
  const mutations = records.filter((r) => ['check_in', 'check_out', 'adjust', 'reset'].includes(r.action));
  const peak = buckets.reduce((best, b) => b.peak != null && (!best || b.peak > best.peak) ? b : best, null);
  const corrections = records.filter((r) => ['reset', 'adjust'].includes(r.action));
  const coverageMs = unionDuration(tracks.map((t) => [t.from, t.to]));
  const finalCount = buckets.at(-1)?.closing ?? null;
  if (!tracks.length) warnings.push('No capacity session coverage was recorded for this window. Missing data is not zero attendance.');
  else if (!mutations.length) warnings.push('No counter movements were recorded in this window. This does not prove the venue was empty.');
  if (tracks.length && coverageMs < end - start - 1) warnings.push('This window has gaps in capacity session coverage; uncovered hours are shown as unavailable.');
  if (end === ms(window.end) && finalCount > 0) warnings.push(`Incomplete closeout: the final recorded counter was ${finalCount}. Unrecorded exits cannot be recovered; this is not proof people remained inside.`);
  if (corrections.length) warnings.push(`${corrections.length} reset or manual adjustment operation(s) affected occupancy. They are shown separately, not counted as departures.`);
  if (tracks.some((t) => !valueAt(t, t.from))) warnings.push('One or more session segments have no opening audit anchor. Occupancy is unknown until a recorded count becomes available.');
  if (ties.size) warnings.push('Some count changes share an identical timestamp. Their exact order is unknown; affected closing counts may be unavailable.');
  if (tracks.some((t, i) => tracks.some((u, j) => j > i && t.from < u.to && u.from < t.to))) warnings.push('Capacity sessions overlap. Do not treat this as a verified event-exclusive count.');
  return {
    date, window, observedUntil: iso(end), isCurrent: start <= now && now < ms(window.end),
    buckets, warnings, summary: {
      entries: tracks.length ? buckets.reduce((n, b) => n + (b.entries || 0), 0) : null,
      exits: tracks.length ? buckets.reduce((n, b) => n + (b.exits || 0), 0) : null,
      peak: peak?.peak ?? null, peakAt: peak?.peakAt ?? null, limit: peak?.limit ?? null,
      finalCount, corrections: corrections.length,
      lastMovement: mutations.at(-1)?.created_at ?? null,
      auditRows: records.length,
    },
  };
}

export function capacityCsv(report, title) {
  const fields = ['event_or_night', 'operating_date', 'hour_start_utc', 'hour_end_utc', 'hour_local', 'timezone', 'entries', 'exits', 'peak_recorded', 'hour_end_count', 'corrections', 'correction_delta', 'coverage', 'attribution'];
  const rows = report.buckets.map((b) => [title, report.date, b.start, b.end, b.label, CAPACITY_TIMEZONE, b.entries, b.exits, b.peak, b.closing, b.corrections, b.correctionDelta, b.coverage, 'Venue-wide operating window; not event-exclusive']);
  // Prevent spreadsheet formula execution from an event title.
  const escape = (value) => {
    let s = value == null ? '' : String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r\n]/.test(s)) s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  return [fields, ...rows].map((r) => r.map(escape).join(',')).join('\r\n');
}
