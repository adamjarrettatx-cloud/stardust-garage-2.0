// Render the Time row on the public/preview event page exactly the way the
// admin typed it.
//
// events.event_time is free text. In production it very often already
// contains a range (e.g. '10PM - LATE', '9 PM - 2 AM', '10 pm to late').
// Older code always joined event_time and event_end_time with an en-dash,
// which produced things like '10PM - LATE – LATE' when both fields were
// populated.
//
// Rules:
//   1. No end time → show event_time as-is.
//   2. event_time already looks like a range (contains a dash or the word
//      'to') → show event_time as-is; ignore end_time.
//   3. Otherwise → show 'event_time – end_time'.
export function formatEventTime(eventTime, eventEndTime) {
  if (!eventTime) return '';
  const end = (eventEndTime || '').trim();
  if (!end) return eventTime;
  const looksLikeRange = /[–—\-]|\bto\b/i.test(eventTime);
  if (looksLikeRange) return eventTime;
  return `${eventTime} – ${end}`;
}
