// Programmer date pitches: shared validation and display helpers.
//
// Safe for client components. The database functions in
// supabase/migrations/20261015120000_programmer_date_pitches.sql remain
// authoritative for who may pitch, which dates are open and what an approval
// creates; this module only shapes input and labels.

export const ATTENDANCE_OPTIONS = Object.freeze([
  { value: 'under_100', label: 'Under 100' },
  { value: '100_250', label: '100–250' },
  { value: '250_400', label: '250–400' },
  { value: '400_plus', label: '400+' },
]);

export const PITCH_STATUS_LABELS = Object.freeze({
  pending: 'Pending review',
  approved: 'Approved',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
});

export const PITCH_LIMITS = Object.freeze({ title: 120, concept: 4000, lineup: 2000, notes: 2000, declineReason: 1000 });

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function attendanceLabel(value) {
  return ATTENDANCE_OPTIONS.find((o) => o.value === value)?.label || '';
}

// "21:30" → "9:30 PM"
export function timeLabel(value) {
  if (!TIME_RE.test(String(value || ''))) return '';
  const [h, m] = value.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function timeRangeLabel(start, end) {
  const a = timeLabel(start);
  const b = timeLabel(end);
  return a && b ? `${a} – ${b}` : a || '';
}

// "2026-11-07" → "Saturday, November 7, 2026" without timezone drift.
export function longDateLabel(iso) {
  if (!DATE_RE.test(String(iso || ''))) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

export function shortDateLabel(iso) {
  if (!DATE_RE.test(String(iso || ''))) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Returns { value } with the RPC arguments, or { error } with a plain message.
export function parsePitchInput(body) {
  const date = clean(body?.date);
  const title = clean(body?.title);
  const concept = clean(body?.concept);
  const lineup = clean(body?.lineup);
  const startTime = clean(body?.startTime);
  const endTime = clean(body?.endTime);
  const attendance = clean(body?.expectedAttendance);
  const notes = clean(body?.notes);

  if (!DATE_RE.test(date)) return { error: 'Choose a date.' };
  if (!title) return { error: 'Add an event name.' };
  if (title.length > PITCH_LIMITS.title) return { error: `Keep the event name under ${PITCH_LIMITS.title} characters.` };
  if (!concept) return { error: 'Describe the concept.' };
  if (concept.length > PITCH_LIMITS.concept) return { error: `Keep the concept under ${PITCH_LIMITS.concept} characters.` };
  if (lineup.length > PITCH_LIMITS.lineup) return { error: `Keep the lineup under ${PITCH_LIMITS.lineup} characters.` };
  if (notes.length > PITCH_LIMITS.notes) return { error: `Keep the notes under ${PITCH_LIMITS.notes} characters.` };
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) return { error: 'Add a start and end time.' };
  if (startTime === endTime) return { error: 'Start and end time cannot be the same.' };
  if (!ATTENDANCE_OPTIONS.some((o) => o.value === attendance)) return { error: 'Choose expected attendance.' };

  return {
    value: {
      p_date: date,
      p_title: title,
      p_concept: concept,
      p_lineup: lineup || null,
      p_start_time: startTime,
      p_end_time: endTime,
      p_expected_attendance: attendance,
      p_notes: notes || null,
    },
  };
}

// Database errors raised by the pitch functions carry user-facing messages for
// the 22023/23505 codes. Anything else is reported generically.
export function pitchErrorResponse(error) {
  const code = error?.code;
  if (code === '42501') return { status: 403, error: 'Date pitches are not available for this profile.' };
  if (code === '22023' || code === '23505') return { status: 409, error: error.message };
  if (code === 'P0002') return { status: 404, error: 'Pitch not found.' };
  return { status: 500, error: 'Something went wrong. Please try again.' };
}

// Group the calendar RPC rows into months for rendering.
export function groupCalendarMonths(days = []) {
  const months = [];
  let current = null;
  for (const day of days) {
    const key = String(day.day).slice(0, 7);
    if (!current || current.key !== key) {
      const [y, m] = key.split('-').map(Number);
      current = {
        key,
        label: new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }),
        // Weekday (0 = Sunday) of the 1st, for leading blanks.
        firstWeekday: new Date(Date.UTC(y, m - 1, 1)).getUTCDay(),
        year: y,
        month: m,
        days: [],
      };
      months.push(current);
    }
    current.days.push(day);
  }
  return months;
}
