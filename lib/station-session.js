import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { STATION_COOKIE, hashStationToken } from '@/lib/station-policy';

// No Auth access/refresh tokens are stored here or returned to station devices.
// A bearer token alone cannot create or resolve a station session.
export async function resolveStationToken(token, admin = createAdminClient()) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = await hashStationToken(token);
  const { data, error } = await admin.rpc('resolve_station_session', { p_hash: hash });
  if (error) return null;
  const station = Array.isArray(data) ? data[0] : data;
  return station?.user_id ? { ...station, sessionHash: hash } : null;
}
export async function stationContext() {
  const store = await cookies();
  const token = store.get(STATION_COOKIE)?.value;
  if (!token) return { present: false, station: null };
  try { return { present: true, station: await resolveStationToken(token) }; }
  catch { return { present: true, station: null }; } // Fail closed; no personal-login fallback.
}
export function stationUser(station) {
  return {
    id: station.user_id,
    email: null,
    app_metadata: { station_account: true },
    user_metadata: { full_name: station.label },
  };
}
