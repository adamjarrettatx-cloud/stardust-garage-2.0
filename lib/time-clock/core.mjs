// Shared pure helpers. Money is an estimate, never a payroll calculation.
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ESTIMATE_NOTICE =
  "Base estimates only. Excludes overtime, tips, taxes, deductions, and payroll adjustments. Breaks are counted time.";

export function chicagoInput(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}
export function chicagoToIso(value, offset = "") {
  const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    ? value + ":00"
    : value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local))
    throw new Error("Enter a valid Austin date and time.");
  const candidates = ["-05:00", "-06:00"]
    .filter((o) => !offset || o === offset)
    .map((o) => `${local}${o}`)
    .filter((v) => Number.isFinite(Date.parse(v)) && chicagoInput(v) === local);
  if (!candidates.length)
    throw new Error(
      "That Austin time does not exist, or the selected DST offset is incorrect.",
    );
  if (candidates.length > 1)
    throw new Error(
      "This hour occurs twice at the fall time change. Choose CDT (first) or CST (second).",
    );
  return new Date(candidates[0]).toISOString();
}
export function elapsedMs(shift, now = Date.now()) {
  return Math.max(
    0,
    (shift.ended_at ? Date.parse(shift.ended_at) : now) -
      Date.parse(shift.started_at),
  );
}
export function duration(ms) {
  const min = Math.floor(Math.max(0, ms) / 60000);
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
}
export function estimateCents(shift) {
  if (!shift.ended_at || shift.pay_basis === "unset") return null;
  if (shift.pay_basis === "flat")
    return Number.isInteger(shift.flat_cents) ? shift.flat_cents : null;
  if (
    !shift.segments?.length ||
    shift.segments.some((s) => !Number.isInteger(s.rate_cents) || !s.ended_at)
  )
    return null;
  return Math.round(
    shift.segments.reduce(
      (sum, s) =>
        sum +
        (Math.max(0, Date.parse(s.ended_at) - Date.parse(s.started_at)) /
          3600000) *
          s.rate_cents,
      0,
    ),
  );
}
export function dollarsToCents(value) {
  if (value === "" || value === null || value === undefined) return null;
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(String(value)))
    throw new Error("Enter a dollar amount with up to two decimal places.");
  const [whole, fraction = ""] = String(value).split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (cents > 100000000) throw new Error("Amount is too large.");
  return cents;
}
export function csvCell(value) {
  const s = String(value ?? "");
  return `"${(/^[\s]*[=+\-@]/.test(s) || /^[\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""')}"`;
}
export function shiftsCsv(shifts) {
  return [
    ["SDG TIMEKEEPING - NOT FINAL PAYROLL", ESTIMATE_NOTICE],
    [
      "Name",
      "Category",
      "Roles",
      "Start UTC",
      "End UTC",
      "Display timezone",
      "Elapsed hours",
      "Pay basis",
      "Base estimate USD",
      "Status",
      "Version",
      "Tasks complete",
      "Handoff",
    ],
    ...shifts.map((s) => [
      s.worker_name,
      s.category,
      [...new Set(s.segments.map((g) => g.role_name))].join(" / "),
      s.started_at,
      s.ended_at ?? "",
      "America/Chicago",
      s.ended_at ? (elapsedMs(s) / 3600000).toFixed(4) : "",
      s.pay_basis,
      estimateCents(s) === null ? "" : (estimateCents(s) / 100).toFixed(2),
      s.status,
      s.version,
      `${s.tasks.filter((t) => t.done).length}/${s.tasks.length}`,
      s.note,
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}
