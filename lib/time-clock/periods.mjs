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
