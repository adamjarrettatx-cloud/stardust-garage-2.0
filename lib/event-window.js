// event-window.js
//
// Turn a stored event (event_date + free-form event_time text) into a real
// [start, end] instant window in the venue's timezone (America/Chicago).
//
// The trial-pass analytics "By event" tab uses these windows to attribute
// each trial signup to the event that was happening when the guest signed
// up, since the pass rows themselves have no event_id.
//
// event_time in production is human-typed and comes in shapes like:
//   "10:00 PM"          single start time, no end
//   "10:00 pm"
//   "10:00"             ambiguous — treated as 10am unless clearly pm-only
//   "10:00PM - LATE"    start + "LATE" tail
//   "10 - LATE"
//   "6:45PM - 8:45PM"   explicit start + end
//   "6:30PM - 2:00AM"   spans midnight
//   "2PM - 11PM"
//   ""                  missing
//
// We parse tolerantly; anything unreadable falls back to a whole-day window
// so the event still receives its attributed signups.

const CT_TZ = 'America/Chicago';
const HOUR_MS = 60 * 60 * 1000;

// Buffers: someone signing up 2h before doors are open is almost certainly
// there for that night. Post-event, we accept another 2h (line at the end,
// people finishing up outside).
//
// Late-night events (start hour >= 7 PM) are treated as running until 6 AM the
// following morning even when event_time only lists a start time or ends with
// "LATE", because SDG night events legitimately do run until 5-6am. The
// following-day event's own pre-buffer already claims signups within 2h of
// its start, so a Sat 2 PM show and a Fri late night with a 6 AM tail don't
// fight over signups: the 4 AM - 12 PM Sat gap belongs to the Fri night, and
// 12 PM onward belongs to Sat.
export const PRE_BUFFER_MS = 2 * HOUR_MS;
export const POST_BUFFER_MS = 2 * HOUR_MS;
const LATE_NIGHT_START_HH = 19; // 7 PM
const LATE_NIGHT_END_HH = 6;   // 6 AM next day

// Parse a single time token like "10:00 PM", "10PM", "6:45pm", "10", "2AM"
// into 24h hours + minutes. Returns null if unparseable.
export function parseTimeToken(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  // Explicit "LATE" and other placeholders: caller handles this.
  if (/^late$/i.test(s)) return { hh: null, mm: null, late: true };

  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let hh = parseInt(m[1], 10);
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  const suffix = m[3];
  if (Number.isNaN(hh) || hh > 24 || mm > 59) return null;

  if (suffix === 'am') {
    if (hh === 12) hh = 0;
  } else if (suffix === 'pm') {
    if (hh !== 12) hh += 12;
  } else {
    // No suffix. This is the ambiguous case.
    //   "10:00"  -> assume evening (10pm) — night events are the norm here
    //              and any daytime event we've seen ("2PM - 11PM") includes
    //              its suffix. This is a heuristic, not a guarantee.
    if (hh < 8) hh += 12; // "1", "2" -> pm; "10", "11" stay ambiguous handled below
    if (hh <= 11) hh += 12; // "10" -> 22
  }
  return { hh, mm, late: false };
}

// Split "6:45PM - 8:45PM" or "10:00PM - LATE" or "10:00 PM" into
// { startTok, endTok } tokens.
export function splitTimeRange(raw) {
  if (!raw) return { startTok: null, endTok: null };
  const s = String(raw).trim();
  // Split on hyphen surrounded by optional spaces, or on the word "to".
  const parts = s.split(/\s*(?:-|–|—|to)\s*/i);
  if (parts.length >= 2) {
    return { startTok: parts[0].trim(), endTok: parts[1].trim() };
  }
  return { startTok: s, endTok: null };
}

// Given the venue-local wall-clock components (yyyy-mm-dd + hh:mm), return
// the UTC epoch ms that corresponds to that wall-clock instant in
// America/Chicago. We do this by asking Intl to render an anchor UTC instant
// in Chicago and back-solving the offset. Correct across DST because the
// offset is computed against the actual event date, not a fixed constant.
export function centralWallClockToUtcMs(y, mo, d, hh, mm) {
  // Start with the naive UTC guess: pretend the wall clock is UTC.
  const naiveUtc = Date.UTC(y, mo - 1, d, hh, mm, 0);
  // Ask Intl what wall-clock that instant renders as in Chicago.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CT_TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(naiveUtc));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  // Intl renders "24" for midnight in hour12:false — normalize to 0.
  const renderedHour = get('hour') % 24;
  const rendered = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    renderedHour,
    get('minute'),
    0,
  );
  // Chicago is behind UTC. If rendered < naive, the offset is (naive-rendered);
  // shifting the naive guess forward by that offset lands on the real UTC.
  const offset = naiveUtc - rendered;
  return naiveUtc + offset;
}

// Compute the [start, end] UTC ms window for an event, given its stored
// event_date ('YYYY-MM-DD') and event_time text. Buffers already applied.
//
// Returns { startMs, endMs, parsed: boolean }. `parsed=false` means the
// event_time text was unreadable and we fell back to a whole-day window
// (00:00 local -> 24:00 local, then buffered).
export function computeEventWindow(eventDate, eventTime) {
  if (!eventDate) return null;
  const [y, mo, d] = String(eventDate).split('-').map(Number);
  if (!y || !mo || !d) return null;

  // Whole-day fallback in CT.
  const fallback = () => {
    const start = centralWallClockToUtcMs(y, mo, d, 6, 0); // 6am local
    const nextDay = new Date(Date.UTC(y, mo - 1, d));
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const end = centralWallClockToUtcMs(
      nextDay.getUTCFullYear(),
      nextDay.getUTCMonth() + 1,
      nextDay.getUTCDate(),
      6,
      0,
    ); // 6am the next day
    return { startMs: start, endMs: end, parsed: false };
  };

  if (!eventTime) return fallback();
  const { startTok, endTok } = splitTimeRange(eventTime);
  const start = parseTimeToken(startTok);
  if (!start || start.late || start.hh == null) return fallback();

  const startMs = centralWallClockToUtcMs(y, mo, d, start.hh, start.mm);

  // End: three cases.
  //   1. explicit end token that parses cleanly ("11:00 PM", "2:00 AM")
  //   2. "LATE" or unparseable end -> late-night default: 6am next day for a
  //      night-start event, otherwise start + 4h.
  //   3. no end token at all       -> same as case 2.
  const isLateNightStart = start.hh >= LATE_NIGHT_START_HH;
  const lateNightEndMs = () => {
    const nextDay = new Date(Date.UTC(y, mo - 1, d));
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    return centralWallClockToUtcMs(
      nextDay.getUTCFullYear(),
      nextDay.getUTCMonth() + 1,
      nextDay.getUTCDate(),
      LATE_NIGHT_END_HH,
      0,
    );
  };

  let endMs;
  if (endTok) {
    const end = parseTimeToken(endTok);
    if (end && !end.late && end.hh != null) {
      // Explicit end. If end is earlier than start (e.g. 6:30PM -> 2:00AM),
      // it belongs to the next calendar day.
      let endY = y;
      let endMo = mo;
      let endD = d;
      const endMinutes = end.hh * 60 + end.mm;
      const startMinutes = start.hh * 60 + start.mm;
      if (endMinutes <= startMinutes) {
        const nextDay = new Date(Date.UTC(y, mo - 1, d));
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        endY = nextDay.getUTCFullYear();
        endMo = nextDay.getUTCMonth() + 1;
        endD = nextDay.getUTCDate();
      }
      endMs = centralWallClockToUtcMs(endY, endMo, endD, end.hh, end.mm);
    } else {
      // "LATE" or garbled. Night events run until 6am; daytime events get +4h.
      endMs = isLateNightStart ? lateNightEndMs() : startMs + 4 * HOUR_MS;
    }
  } else {
    // No end token. Same rule as "LATE".
    endMs = isLateNightStart ? lateNightEndMs() : startMs + 4 * HOUR_MS;
  }

  return {
    startMs: startMs - PRE_BUFFER_MS,
    endMs: endMs + POST_BUFFER_MS,
    parsed: true,
  };
}
