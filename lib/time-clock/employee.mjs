// Employee portal helpers shared by routes and tests. No secrets here.
export const EMPLOYEE_EMAIL_DOMAIN = "employee.sdgatx.invalid";

export function normalizeEmployeeUsername(value) {
  if (typeof value !== "string") return null;
  const username = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(username) ? username : null;
}
export function employeeAuthEmail(id) {
  return `emp-${id}@${EMPLOYEE_EMAIL_DOMAIN}`;
}
export function isInternalEmployeeEmail(email) {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${EMPLOYEE_EMAIL_DOMAIN}`);
}
// Sign-in identifier: an email (contains @) or a username.
export function parseIdentifier(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (!v || v.length > 254) return null;
  if (v.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { email: v } : null;
  const username = normalizeEmployeeUsername(v);
  return username ? { username } : null;
}
