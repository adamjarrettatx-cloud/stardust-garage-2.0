// Shared, pure schedule helpers (server validation + client calendar).
import { UUID } from "./core.mjs";

export class ScheduleInputError extends Error {}

const ISO_WITH_OFFSET = /(Z|[+-]\d{2}:\d{2})$/;

// Server-side allowlist of one schedule entry. Throws a ClockError-compatible
// message (the route wraps it) — never trusts browser-supplied identity.
export function validScheduleEntry(e) {
  const fail = (m) => {
    const err = new Error(m);
    err.status = 400;
    err.isClockInput = true;
    throw err;
  };
  if (!e || typeof e !== "object") fail("Invalid shift.");
  if (!UUID.test(e.worker_id ?? "")) fail("Choose a person for each shift.");
  if (!/^[a-z_]{2,40}$/.test(e.role_id ?? "")) fail("Choose a role for each person.");
  for (const key of ["starts_at", "ends_at"]) {
    if (
      typeof e[key] !== "string" ||
      !ISO_WITH_OFFSET.test(e[key]) ||
      !Number.isFinite(Date.parse(e[key]))
    )
      fail("Times must include a UTC offset.");
  }
  const start = Date.parse(e.starts_at),
    end = Date.parse(e.ends_at);
  if (end <= start || end - start > 24 * 3600000)
    fail("The end must be after the start and within 24 hours.");
  if (e.note !== undefined && (typeof e.note !== "string" || e.note.length > 500))
    fail("Notes can be up to 500 characters.");
  return {
    worker_id: e.worker_id,
    role_id: e.role_id,
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(end).toISOString(),
    note: (e.note || "").trim(),
  };
}

// "HH:MM" on an Austin calendar day -> { starts_at, ends_at } ISO strings.
// An end time at or before the start rolls to the next day (overnight shift).
export function austinShiftRange(day, startTime, endTime, toIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ScheduleInputError("Choose a date.");
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime))
    throw new ScheduleInputError("Choose a start and end time.");
  const starts_at = toIso(`${day}T${startTime}`);
  let endDay = day;
  if (endTime <= startTime) {
    const [y, m, d] = day.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    endDay = next.toISOString().slice(0, 10);
  }
  const ends_at = toIso(`${endDay}T${endTime}`);
  return { starts_at, ends_at };
}

export function scheduledHours(entries) {
  return entries.reduce(
    (sum, e) => sum + (Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 3600000,
    0,
  );
}
