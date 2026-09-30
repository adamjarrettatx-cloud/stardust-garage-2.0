// Shared by Edge middleware, server gates, and tests. This is an allowlist:
// adding a new staff API does NOT automatically grant a station access.
export const STATION_COOKIE = '__Host-sdg-station';
export const STATION_SESSION_SECONDS = 12 * 60 * 60;
export const STATION_ROLE_LABELS = { front_desk: 'Front Desk', security: 'Security', calendar_availability: 'Calendar Availability' };
export const STATION_ROLES = Object.keys(STATION_ROLE_LABELS);
export const STATION_SELECT = 'id,username,label,role,active,epoch,reset_started_at,created_at';
const common = [
  'GET /api/station/session',
  'POST /api/station/logout',
];
const frontDesk = [
  'GET /api/door-session/active',
  'GET /api/capacity/status', 'POST /api/capacity/operation',
  'GET /api/capacity/checkins', 'GET /api/capacity/guestlist/events',
  'GET /api/capacity/guestlist/entries', 'POST /api/capacity/guestlist/operation',
  'GET /api/capacity/guestlist/matches',
  'POST /api/capacity/trial-pass/scan', 'POST /api/capacity/trial-pass/roster-checkin',
  'GET /api/team/trial-pass/today', 'POST /api/team/trial-pass/manual',
  'POST /api/door-session/start', 'POST /api/door-session/end',
  'POST /api/tickets/scan', 'POST /api/scan/member-id',
  'GET /api/capacity/access-restrictions', 'POST /api/capacity/access-restrictions',
  'POST /api/capacity/legal-name',
];
const security = ['GET /api/door-session/active', 'POST /api/capacity/security', 'GET /api/station/guest-search'];
const permissions = { front_desk: frontDesk, security, calendar_availability: ['GET /api/station/availability'] };
const homes = { front_desk: '/capacity/front-desk', security: '/capacity/security', calendar_availability: '/staff/availability' };

export function stationHome(role) {
  return Object.hasOwn(homes, role) ? homes[role] : '/staff/login';
}
export function stationCanRequest(role, pathname, method = 'GET') {
  if (!STATION_ROLES.includes(role)) return false;
  const key = `${method.toUpperCase()} ${pathname}`;
  if (pathname === stationHome(role)) return method === 'GET' || method === 'HEAD';
  return common.includes(key) || permissions[role].includes(key);
}
export function normalizeStationUsername(value) {
  if (typeof value !== 'string') return null;
  const username = value.trim().toLowerCase();
  return /^[a-z][a-z0-9-]{2,31}$/.test(username) ? username : null;
}
export function sameOrigin(request) {
  // Missing/null Origin is rejected on browser mutations, including login.
  const origin = request.headers.get('origin');
  return !!origin && origin === new URL(request.url).origin;
}
export async function hashStationToken(token) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
