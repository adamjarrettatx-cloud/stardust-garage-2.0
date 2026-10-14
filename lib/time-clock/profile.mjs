// Shared, client-safe staff profile rules (invite setup and employee portal).
// No secrets or stored values here.
import { isValidPin } from "./pin.mjs";

const COMMON = new Set(["1212", "1122", "2580", "0852", "1004", "2000", "6969", "4321", "1010", "2020"]);
// Easy-to-guess PINs: one repeated digit, straight runs (0123, 9876) and a
// few very common picks.
export function isWeakPin(pin) {
  if (!isValidPin(pin)) return true;
  if (/^(\d)\1{3}$/.test(pin) || COMMON.has(pin)) return true;
  const d = [...pin].map(Number);
  const step = d[1] - d[0];
  return (step === 1 || step === -1) && d.every((n, i) => i === 0 || n - d[i - 1] === step);
}
export function pinProblem(pin, confirm) {
  if (!isValidPin(pin)) return "Your PIN must be exactly four digits.";
  if (confirm !== undefined && pin !== confirm) return "The PINs do not match.";
  if (isWeakPin(pin)) return "That PIN is too easy to guess. Avoid repeated digits and runs like 1234.";
  return null;
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
// Birthday as YYYY-MM-DD. Must be a real calendar date, at least 14 and at
// most 100 years before `today` (YYYY-MM-DD, Austin date).
export function birthdateProblem(value, today) {
  const m = YMD.exec(value || "");
  if (!m) return "Enter your birthday.";
  const [y, mo, d] = m.slice(1).map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d)
    return "Enter a valid birthday.";
  const t = YMD.exec(today || "");
  if (!t) return null;
  const [ty, tm, td] = t.slice(1).map(Number);
  const age = ty - y - (tm < mo || (tm === mo && td < d) ? 1 : 0);
  if (age < 14 || age > 100) return "Check your birthday.";
  return null;
}

// Username suggestion from a staff name: first.last in lowercase ASCII,
// within the username rules. Empty when nothing usable remains.
export function suggestUsername(name = "") {
  const parts = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const base = (parts.length > 1 ? `${parts[0]}.${parts.at(-1)}` : parts[0] || "").slice(0, 32);
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(base) ? base : "";
}
