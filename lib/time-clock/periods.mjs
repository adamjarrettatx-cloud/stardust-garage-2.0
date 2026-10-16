// Pay-period helpers on Austin calendar days. Pure; shared by the server and
// the employee portal. Weeks run Monday through Sunday.
import { chicagoInput, chicagoToIso } from "./core.mjs";

export const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function chicagoYmd(value = Date.now()) {
  return chicagoInput(value).slice(0, 10);
}
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function weekStart(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(ymd, dow === 0 ? -6 : 1 - dow);
}
// Austin midnight always exists (US time changes happen at 2 a.m.).
export function dayStartIso(ymd) {
  return chicagoToIso(`${ymd}T00:00`);
}
export function daysBetween(fromYmd, toYmd) {
  return Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86400000);
}
// Inclusive Austin-day range -> [from, to) instants for the database.
export function periodRange(fromYmd, toYmd, maxDays = 93) {
  if (!YMD.test(fromYmd || "") || !YMD.test(toYmd || "")) return null;
  const span = daysBetween(fromYmd, toYmd);
  if (!Number.isFinite(span) || span < 0 || span >= maxDays) return null;
  return { from: dayStartIso(fromYmd), to: dayStartIso(addDays(toYmd, 1)) };
}

// Payroll runs every two weeks, Monday through the second Sunday. Every pay
// period is counted from this known first Monday; changing it shifts all
// period boundaries, so treat it as a payroll setting.
export const PAY_PERIOD_ANCHOR = "2026-09-28";
export const PAY_PERIOD_DAYS = 14;

// First Monday of the pay period containing an Austin calendar day.
export function payPeriodStart(ymd = chicagoYmd()) {
  const offset = daysBetween(PAY_PERIOD_ANCHOR, ymd);
  const index = Math.floor(offset / PAY_PERIOD_DAYS);
  return addDays(PAY_PERIOD_ANCHOR, index * PAY_PERIOD_DAYS);
}
// Last Sunday (inclusive) of the pay period that starts on `startYmd`.
export function payPeriodEnd(startYmd) {
  return addDays(startYmd, PAY_PERIOD_DAYS - 1);
}
// Pay period `n` periods away from the one containing `ymd` (-1 = prior).
export function payPeriodAt(ymd = chicagoYmd(), n = 0) {
  const start = addDays(payPeriodStart(ymd), n * PAY_PERIOD_DAYS);
  return { start, end: payPeriodEnd(start) };
}
// "Oct 12 – Oct 25" (year added when the period crosses into a new year).
export function payPeriodLabel(startYmd) {
  const end = payPeriodEnd(startYmd);
  const fmt = (ymd, year) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) })
      .format(new Date(`${ymd}T12:00:00Z`));
  const crosses = startYmd.slice(0, 4) !== end.slice(0, 4);
  return `${fmt(startYmd, crosses)} – ${fmt(end, crosses)}`;
}
