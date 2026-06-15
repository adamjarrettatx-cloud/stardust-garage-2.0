// Server-only verification for capacity door device tokens (Phase 1.1).
//
// The two Jelly2 door phones are NOT Supabase-authenticated — they present a
// long random token instead of a session cookie. Because the token table is
// admin-only under RLS, verifying a presented token requires the service-role
// client (which bypasses RLS). That key MUST stay on the server: this module is
// imported only from app/api/** route handlers, never from a client component.
//
// resolveDeviceFromToken() hashes the presented token, looks up the matching
// ACTIVE, non-revoked device row, and returns a small descriptor the route uses
// to (a) decide which device RPC to call and (b) reject any op outside the
// device's scope. It returns null for missing/invalid/revoked tokens so callers
// can answer with a uniform "device not authorized" without leaking which part
// failed.
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import {
  hashDeviceToken,
  isDeviceActive,
  isValidDeviceRole,
} from '@/lib/capacity-device-utils';

// Resolve a raw device token to its device row, or null if it is missing,
// malformed, unknown, inactive, or revoked. Never throws on a bad token.
export async function resolveDeviceFromToken(rawToken) {
  const tokenHash = hashDeviceToken(rawToken);
  if (!tokenHash) return null;

  // No Supabase configured (dev/stub) — there is no token store to check.
  if (!isSupabaseConfigured()) return null;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    // Missing service-role key — treat as unverifiable rather than crashing.
    return null;
  }

  const { data, error } = await admin
    .from('capacity_device_tokens')
    .select('id, label, device_role, active, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !data) return null;
  if (!isDeviceActive(data)) return null;
  if (!isValidDeviceRole(data.device_role)) return null;

  return {
    id: data.id,
    label: data.label,
    role: data.device_role,
  };
}
