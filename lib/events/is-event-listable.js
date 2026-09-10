// Time-aware rule for "is this event still worth showing on the public
// events page and homepage?"
//
// The events table only has free-text time fields (`event_time` and
// `event_end_time`), so this file has to do the parsing itself. All time
// comparisons happen in America/Chicago because everything we sell is in
// that timezone; the row's `event_date` is a plain date.
//
// Rule (per venue operator, 2026-09-09):
//
//   1. If the event has a specific END time, hide it once that end time has
//      passed on the event date.
//   2. If there is no specific end time (missing, "LATE", "TBD", etc.) but
//      we can parse a start time, hide it N hours after start:
//        * N = 6 hours if start >= 9:55 PM CT (late-night party)
//        * N = 8 hours if start <  9:55 PM CT (earlier evening event)
//   3. If neither start nor end is parseable, fall back to hiding once the
//      event date itself is in the past (the previous behavior).
//
// This module is pure and dependency-free so it can be unit tested and
// reused by every public listing surface.

const CHICAGO_TZ = 'America/Chicago';

// Late-night cutoff: at or after this local start time, treat the event as
// a late-night party and give it only 6 hours before delisting.
const LATE_NIGHT_HOUR = 21;   // 9 PM
const LATE_NIGHT_MINUTE = 55; // :55  → 21:55 (9:55 PM)

const LATE_NIGHT_DURATION_HOURS = 6;
const EARLY_DURATION_HOURS = 8;

// Words that mean "no defined end time" when they appear in an end-time
// slot or as the tail of a range.
const VAGUE_END_WORDS = /\b(late|tbd|tba|until\s+close|close|closing|open\s+end)\b/i;

// --- date/time helpers ------------------------------------------------------

// Convert a `Date` to the wall-clock offset (in minutes east of UTC) that
// America/Chicago is at that instant. Handles DST without a library.
function chicagoOffsetMinutes(date) {
  // en-US "longOffset" yields e.g. "GMT-05:00" or "GMT-06:00".
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TZ,
    timeZoneName: 'longOffset',
  }).formatToParts(date);
  const tzPart = parts.find((p) => p.type === 'timeZoneName');
  const match = tzPart && /GMT([+-])(\d{2}):(\d{2})/.exec(tzPart.value);
  if (!match) return -6 * 60; // Fall back to CST if the runtime is unusual.
  const sign = match[1] === '+' ? 1 : -1;
  return sign * (parseInt(match[2], 10) * 60 + parseInt(match[3], 10));
}

// Build a UTC `Date` for a given local Chicago wall-clock moment
// (yyyy-mm-dd + hour/minute). Applies whichever offset Chicago is on that
// day, so DST transitions are handled correctly.
function chicagoWallClockToUtc(dateString, hour, minute) {
  const [y, m, d] = dateString.split('-').map(Number);
  // First guess: assume Chicago is CST (UTC-6). Then rebuild with the real
  // offset that Chicago has AT that guessed instant. Two passes is enough
  // because DST offsets only shift by an hour.
  const guess = new Date(Date.UTC(y, m - 1, d, hour + 6, minute));
  const offset = chicagoOffsetMinutes(guess); // e.g. -300 for CDT
  return new Date(Date.UTC(y, m - 1, d, hour, minute) - offset * 60_000);
}

// --- time-string parsing ----------------------------------------------------

// Parse a single clock string like "6:45PM", "6 pm", "10PM", "9:00 AM".
// Returns { hour, minute } in 24-hour form, or null.
function parseClock(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // Match H, H:MM, H.MM optionally followed by AM/PM (with or without space).
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?\s*m\.?$/i.exec(s);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3].toLowerCase();
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (meridiem === 'a') {
    if (hour === 12) hour = 0;
  } else {
    if (hour !== 12) hour += 12;
  }
  return { hour, minute };
}

// True when a string means "no real end time" — LATE, TBD, empty, etc.
function isVagueEnd(raw) {
  if (!raw) return true;
  const s = String(raw).trim();
  if (!s) return true;
  return VAGUE_END_WORDS.test(s);
}

// Given the two free-text fields on `events`, extract a start clock and an
// end clock (either may be null). Understands three shapes commonly typed
// by the admin:
//   * event_time already contains a range: "6:45PM - 8:45PM", "9 PM - 2 AM",
//     "10 pm to late", "10PM – LATE"
//   * event_time is a lone start time and event_end_time holds the end
//   * event_time is a lone start time with no end (returns end = null)
function extractStartAndEnd(eventTime, eventEndTime) {
  const start = { clock: null, raw: null };
  const end = { clock: null, raw: null };

  const timeText = (eventTime || '').trim();
  const endText = (eventEndTime || '').trim();

  if (timeText) {
    // Split on dash variants or the word "to".
    const parts = timeText.split(/\s*(?:[–—-]|\bto\b)\s*/i);
    if (parts.length >= 2) {
      start.raw = parts[0];
      start.clock = parseClock(parts[0]);
      end.raw = parts.slice(1).join(' ').trim();
      end.clock = parseClock(end.raw);
    } else {
      start.raw = timeText;
      start.clock = parseClock(timeText);
    }
  }

  // event_end_time wins over an in-line end only if we successfully parse it.
  if (endText) {
    const parsed = parseClock(endText);
    if (parsed) {
      end.raw = endText;
      end.clock = parsed;
    } else if (!end.raw) {
      end.raw = endText;
    }
  }

  return { start, end };
}

// --- public API -------------------------------------------------------------

// Compute the moment (as a `Date` in UTC) at which the event should drop off
// the public listings, per the rule above. Returns null if we cannot decide
// from the row alone (caller should fall back to the date-only rule).
export function computeEventListingCutoff(event) {
  if (!event || !event.event_date) return null;
  const dateStr = event.event_date;

  const { start, end } = extractStartAndEnd(event.event_time, event.event_end_time);

  // Case 1: a concrete end time we understand.
  if (end.clock && !isVagueEnd(end.raw)) {
    let endDate = dateStr;
    // End-clock earlier than start-clock means the event crosses midnight
    // (e.g. 10 PM – 2 AM). Roll the end into the next calendar day.
    if (start.clock) {
      const startMinutes = start.clock.hour * 60 + start.clock.minute;
      const endMinutes = end.clock.hour * 60 + end.clock.minute;
      if (endMinutes <= startMinutes) {
        endDate = addDays(dateStr, 1);
      }
    }
    return chicagoWallClockToUtc(endDate, end.clock.hour, end.clock.minute);
  }

  // Case 2: parseable start, vague or missing end.
  if (start.clock) {
    const startMinutes = start.clock.hour * 60 + start.clock.minute;
    const cutoffMinutes = LATE_NIGHT_HOUR * 60 + LATE_NIGHT_MINUTE;
    const isLateNight = startMinutes >= cutoffMinutes;
    const duration = isLateNight ? LATE_NIGHT_DURATION_HOURS : EARLY_DURATION_HOURS;
    const startUtc = chicagoWallClockToUtc(dateStr, start.clock.hour, start.clock.minute);
    return new Date(startUtc.getTime() + duration * 60 * 60 * 1000);
  }

  // Case 3: nothing to work with.
  return null;
}

// True when the event should still appear on public listings at `now`.
// Falls back to the previous date-only rule (visible through the end of the
// event date in Chicago) when we cannot parse the times.
export function isEventStillListable(event, now = new Date()) {
  if (!event || !event.event_date) return false;
  const cutoff = computeEventListingCutoff(event);
  if (cutoff) return now < cutoff;

  // Date-only fallback: visible until the day rolls over in Chicago.
  const endOfDay = chicagoWallClockToUtc(addDays(event.event_date, 1), 0, 0);
  return now < endOfDay;
}

function addDays(dateString, days) {
  const [y, m, d] = dateString.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// Exposed for tests only.
export const __internals = {
  parseClock,
  extractStartAndEnd,
  isVagueEnd,
  chicagoWallClockToUtc,
  addDays,
};
