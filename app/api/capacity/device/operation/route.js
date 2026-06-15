import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { resolveDeviceFromToken } from '@/lib/capacity-device-auth';
import { extractDeviceToken, deviceCanPerform } from '@/lib/capacity-device-utils';
import { deriveStatus, mapRpcError } from '@/lib/capacity-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/capacity/device/operation
// Body: { op, note? }   Token in Authorization: Bearer <t> or ?token=<t>.
//
// The ONLY mutation a door device may perform: check_in for a front_door token,
// check_out for an exit_door token. We verify the token, then enforce scope with
// deviceCanPerform() BEFORE dispatching to the matching device RPC. The RPC also
// re-checks the device role at the database boundary (defense in depth), so a
// front-door token can never check someone out and vice versa. The device is not
// a Supabase user, so we use the service-role client — strictly inside this
// route, only after token + scope validation.
const DEVICE_RPC = {
  check_in: 'capacity_device_check_in',
  check_out: 'capacity_device_check_out',
};

export async function POST(request) {
  const url = new URL(request.url);
  const token = extractDeviceToken({
    authHeader: request.headers.get('authorization'),
    queryToken: url.searchParams.get('token'),
  });

  const device = await resolveDeviceFromToken(token);
  if (!device) {
    return NextResponse.json({ error: 'Device not authorized', code: 'forbidden' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'bad_input' }, { status: 400 });
  }

  const op = body?.op;
  // Scope check: the token's role must permit exactly this op.
  if (!deviceCanPerform(device.role, op)) {
    return NextResponse.json({ error: 'This device cannot perform that action.', code: 'forbidden' }, { status: 403 });
  }

  const note = typeof body?.note === 'string' ? body.note.slice(0, 280) : null;

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured in this environment.', code: 'error' }, { status: 500 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc(DEVICE_RPC[op], { p_device_id: device.id, p_note: note });

  if (error) {
    const mapped = mapRpcError(error);
    return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.httpStatus });
  }

  const session = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ ok: true, session: session || null, status: deriveStatus(session) });
}
