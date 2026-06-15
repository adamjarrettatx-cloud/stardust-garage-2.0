import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import {
  generateDeviceToken,
  hashDeviceToken,
  isValidDeviceRole,
  buildDeviceSetupUrl,
} from '@/lib/capacity-device-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin-only provisioning for capacity door device tokens.
//
//   GET    -> list device tokens (no hashes, no raw tokens)
//   POST   -> create a token for { device_role, label }, returns the RAW token
//             and a one-time setup URL (shown to the admin exactly once)
//   PATCH  -> revoke a token { id } (sets active=false, revoked_at=now)
//
// Every method is gated by requireAdmin() (team_members.role = 'admin'). The
// token table is admin-only under RLS, so reads/writes here use the user-scoped
// (RLS-aware) client where possible; creation uses the service-role client only
// to write the hash, never to broaden access.

// Shape a device row for the client. NEVER includes token_hash or raw token.
function publicDevice(row) {
  return {
    id: row.id,
    label: row.label,
    device_role: row.device_role,
    active: row.active,
    revoked_at: row.revoked_at,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
  };
}

export async function GET() {
  const { unauthorized } = await requireAdmin();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('capacity_device_tokens')
    .select('id, label, device_role, active, revoked_at, last_used_at, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'Failed to load devices' }, { status: 500 });
  }
  return NextResponse.json({ devices: (data || []).map(publicDevice) });
}

export async function POST(request) {
  const { user, unauthorized } = await requireAdmin();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const role = body?.device_role;
  if (!isValidDeviceRole(role)) {
    return NextResponse.json({ error: 'device_role must be front_door or exit_door.' }, { status: 400 });
  }
  const label = typeof body?.label === 'string' && body.label.trim()
    ? body.label.trim().slice(0, 120)
    : (role === 'front_door' ? 'Front Door device' : 'Exit Door device');

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured in this environment.' }, { status: 500 });
  }

  // Generate the raw token ONCE, store only its hash. The raw token is returned
  // in this response and never persisted or logged.
  const rawToken = generateDeviceToken();
  const tokenHash = hashDeviceToken(rawToken);

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  const { data, error } = await admin
    .from('capacity_device_tokens')
    .insert({
      label,
      device_role: role,
      token_hash: tokenHash,
      active: true,
      created_by: user.id,
    })
    .select('id, label, device_role, active, revoked_at, last_used_at, created_at')
    .single();

  if (error) {
    return NextResponse.json({ error: 'Failed to create device: ' + error.message }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  const setupUrl = buildDeviceSetupUrl(origin, role, rawToken);

  // token + setup_url are returned exactly once; the client must surface them
  // immediately because they cannot be retrieved again.
  return NextResponse.json({
    device: publicDevice(data),
    token: rawToken,
    setup_url: setupUrl,
  });
}

export async function PATCH(request) {
  const { user, unauthorized } = await requireAdmin();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const id = body?.id;
  if (typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  }
  if (body?.action !== 'revoke') {
    return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('capacity_device_tokens')
    .update({ active: false, revoked_at: new Date().toISOString(), revoked_by: user.id })
    .eq('id', id)
    .select('id, label, device_role, active, revoked_at, last_used_at, created_at')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Failed to revoke device.' }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Device not found.' }, { status: 404 });
  }
  return NextResponse.json({ device: publicDevice(data) });
}
