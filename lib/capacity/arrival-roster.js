// Shared, deterministic roster ordering. Reads/searches never manufacture times.
export function shiftWindow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]));
  const day = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
  if (Number(parts.hour) < 6) day.setUTCDate(day.getUTCDate() - 1);
  const shiftDay = day.toISOString().slice(0, 10);
  const offset = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', timeZoneName: 'longOffset',
  }).formatToParts(day).find(p => p.type === 'timeZoneName').value;
  const [, sign, hours, minutes] = offset.match(/GMT([+-])(\d{2}):(\d{2})/);
  const offsetMinutes = (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
  return { shiftDay, since: new Date(Date.parse(`${shiftDay}T06:00:00Z`) - offsetMinutes * 60000).toISOString() };
}

export const subjectKey = row => `${row.kind}:${row.id}`;
export function escapeNameSearch(value) {
  return String(value).trim().replace(/[\\%_]/g, '\\$&');
}
export function orderArrivals(rows) {
  return [...rows].sort((a, b) =>
    Date.parse(b.activity_at) - Date.parse(a.activity_at) || subjectKey(a).localeCompare(subjectKey(b)));
}
export function mergeArrivals(rows, incoming) {
  const map = new Map(rows.map(row => [subjectKey(row), row]));
  for (const row of incoming) {
    const key = subjectKey(row), previous = map.get(key);
    // In-flight polls must not move a newly checked-in person backwards.
    map.set(key, previous && Date.parse(previous.activity_at) > Date.parse(row.activity_at)
      ? previous : row);
  }
  return orderArrivals([...map.values()]);
}
