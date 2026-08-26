// events.event_date is a DATE, so it arrives as 'YYYY-MM-DD' with no time and
// no zone. Appending T00:00:00 parses it in local time rather than UTC, which
// is what keeps a Friday event from displaying as Thursday — the same trick
// app/events/page.js uses.
export function formatGrantDate(eventDate) {
  if (!eventDate) return 'Date TBC';
  const date = new Date(`${eventDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'Date TBC';
  return date
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    .toUpperCase();
}
