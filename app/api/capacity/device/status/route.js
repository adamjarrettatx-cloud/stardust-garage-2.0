import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { resolveDeviceFromToken } from '@/lib/capacity-device-auth';
import { extractDeviceToken } from '@/lib/capacity-device-utils';
import { deriveStatus } from '@/lib/capacity-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/capacity/device/status?token=...   (or Authorization: Bearer ...)
//
// Token-scoped status read for a door device. The device is NOT a Supabase
// user, so we verify its token here and, only after the token resolves to an
// ACTIVE device, read the active session via the service-role client. An
// invalid/revoked token gets a uniform 401 — no session data leaks.
//
// The status read is allowed for either a front_door or exit_door device; it is
// scoped to "the current active session" (the only thing a door page needs).
export async function GET(request) {
  const url = new URL(request.url);
  const token = extractDeviceToken({
    authHeader: request.headers.get('authorization'),
    queryToken: url.searchParams.get('token'),
  });

  const device = await resolveDeviceFromToken(token);
  if (!device) {
    return NextResponse.json({ error: 'Device not authorized', code: 'forbidden' }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ session: null, status: deriveStatus(null), device: { role: device.role } });
  }

  const admin = createAdminClient();
  // Touch last_used_at and fetch the active session in one definer call.
  const { data, error } = await admin.rpc('capacity_device_touch', { p_device_id: device.id });
  if (error) {
    // Fall back to a direct read if the RPC is unavailable for any reason.
    const { data: session } = await admin
      .from('capacity_sessions')
      .select('id, name, max_capacity, current_count, is_active, started_at, ended_at, updated_at')
      .eq('is_active', true)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return NextResponse.json({ session: session || null, status: deriveStatus(session), device: { role: device.role } });
  }

  const session = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    session: session || null,
    status: deriveStatus(session),
    device: { role: device.role, label: device.label },
  });
}
