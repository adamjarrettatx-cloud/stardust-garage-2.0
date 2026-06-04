// Studio booking helpers — shared between server (API) and client (UI).
// All time math runs in America/Chicago to match Austin's local time.

const TIMEZONE = 'America/Chicago';

// Returns today's date in Austin time as 'YYYY-MM-DD'
export function getTodayInAustin() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// Returns the current Austin Date object's hour and date.
// Useful for "is this booking more than 24hr in the future?" checks.
export function getNowInAustin() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const obj = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  // Hour can be "24" in some locales — normalize to 0
  const hour = obj.hour === '24' ? 0 : parseInt(obj.hour, 10);
  return {
    date: `${obj.year}-${obj.month}-${obj.day}`,
    hour,
    minute: parseInt(obj.minute, 10),
  };
}

// Get day-of-week (0=Sun ... 6=Sat) for a given YYYY-MM-DD string.
export function dayOfWeek(dateString) {
  // Parse as local at noon to avoid timezone day-shift bugs
  const d = new Date(dateString + 'T12:00:00');
  return d.getDay();
}

// Format an hour (0-23) as a readable string like "9 AM" or "2 PM"
export function formatHour(hour) {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

// Format cents as a dollar string, e.g. 7500 -> "$75"
export function formatMoney(cents) {
  const dollars = cents / 100;
  if (dollars % 1 === 0) {
    return `$${dollars.toFixed(0)}`;
  }
  return `$${dollars.toFixed(2)}`;
}

// Format a YYYY-MM-DD date as something like "Saturday, May 10"
export function formatDateDisplay(dateString) {
  const d = new Date(dateString + 'T12:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

// Returns an array of date objects (YYYY-MM-DD + day-of-week, isBookable)
// for the next `days` days in Austin time.
export function getUpcomingDates(days, openDays) {
  const out = [];
  const today = getTodayInAustin();
  for (let i = 0; i < days; i++) {
    const d = new Date(today + 'T12:00:00');
    d.setDate(d.getDate() + i);
    const dateString = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dow = d.getDay();
    out.push({
      date: dateString,
      dayOfWeek: dow,
      isBookable: openDays.includes(dow),
      label: d.toLocaleDateString('en-US', { weekday: 'short' }),
      dayNum: d.getDate(),
      month: d.toLocaleDateString('en-US', { month: 'short' }),
    });
  }
  return out;
}

// Compute the set of hours that are still "available" for a given date
// once you remove (a) hours blocked by existing confirmed bookings, and
// (b) hours that are within the minimum-advance-time window.
//
// Returns: { hours: number[], blockedByExisting: Set<number>, blockedByAdvance: Set<number> }
export function computeHourStatus({
  openHour,
  closeHour,
  minAdvanceHours,
  bookings, // [{ start_hour, end_hour }]
  date, // YYYY-MM-DD
}) {
  const allHours = [];
  for (let h = openHour; h < closeHour; h++) allHours.push(h);

  const blockedByExisting = new Set();
  for (const b of bookings) {
    for (let h = b.start_hour; h < b.end_hour; h++) {
      blockedByExisting.add(h);
    }
  }

  const blockedByAdvance = new Set();
  const now = getNowInAustin();
  // Compute "how many hours from now" each (date, hour) is. If less
  // than minAdvanceHours, mark it blocked.
  for (const h of allHours) {
    const hoursFromNow = hoursBetween(now.date, now.hour + now.minute / 60, date, h);
    if (hoursFromNow < minAdvanceHours) {
      blockedByAdvance.add(h);
    }
  }

  return { hours: allHours, blockedByExisting, blockedByAdvance };
}

// Returns how many hours separate (fromDate, fromHour) from (toDate, toHour),
// where dates are YYYY-MM-DD strings. Treats them as naive local-time —
// good enough since we computed `now` in Austin and bookings are stored
// as naive Austin times.
export function hoursBetween(fromDate, fromHour, toDate, toHour) {
  const a = new Date(fromDate + 'T00:00:00').getTime();
  const b = new Date(toDate + 'T00:00:00').getTime();
  const dayDiff = (b - a) / (1000 * 60 * 60 * 24);
  return dayDiff * 24 + (toHour - fromHour);
}

// Check if a booking is cancellable by the member (>24hr advance).
export function isCancellable(booking, minAdvanceHours = 24) {
  if (booking.status !== 'confirmed') return false;
  const now = getNowInAustin();
  const hours = hoursBetween(
    now.date,
    now.hour + now.minute / 60,
    booking.booking_date,
    booking.start_hour
  );
  return hours >= minAdvanceHours;
}
