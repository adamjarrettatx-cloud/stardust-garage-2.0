import { randomBytes, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireOwner, getMfaStatus } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { STATION_ROLES, STATION_SELECT, normalizeStationUsername, sameOrigin } from '@/lib/station-policy';

export const runtime = 'nodejs';
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
async function owner() {
  const gate = await requireOwner();
  if (gate.unauthorized) return { denied: reply({ error: 'Unauthorized' }, 401) };
  // Deliberately independent of ENFORCE_ADMIN_MFA: provisioning shared
  // privileged credentials ALWAYS requires a verified second factor.
  if (!(await getMfaStatus()).mfaSatisfied) return { denied: reply({ error: 'MFA required', reason: 'mfa_required' }, 401) };
  return gate;
}
export async function GET() {
  const gate = await owner(); if (gate.denied) return gate.denied;
  try {
    const { data, error } = await createAdminClient().from('station_accounts').select(STATION_SELECT).order('created_at');
    if (error) throw error;
    return reply({ stations: data });
  } catch { return reply({ error: 'Station management is unavailable.' }, 503); }
}
export async function POST(request) {
  if (!sameOrigin(request)) return reply({ error: 'Invalid request origin.' }, 403);
  const gate = await owner(); if (gate.denied) return gate.denied;
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return reply({ error: 'Request too large.' }, 400);
    body = JSON.parse(raw);
  } catch { return reply({ error: 'Invalid request.' }, 400); }
  try {
    const admin = createAdminClient();
    if (body?.action === 'create') {
      const username = normalizeStationUsername(body.username);
      const label = typeof body.label === 'string' ? body.label.trim() : '';
      if (!username || !label || label.length > 80 || !STATION_ROLES.includes(body.role)) {
        return reply({ error: 'Use a 3–32 character username, a station name, and Security or Front Desk.' }, 400);
      }
      const password = randomBytes(24).toString('base64url');
      const email = `${randomUUID()}@station.sdgatx.invalid`;
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        app_metadata: { station_account: true },
        user_metadata: { full_name: label },
      });
      if (error || !data?.user?.id) return reply({ error: 'Could not create the station identity.' }, 503);
      const { data: created, error: insertError } = await admin.rpc('create_station_account', {
        p_actor: gate.user.id, p_user: data.user.id, p_username: username,
        p_label: label, p_role: body.role, p_email: email,
      });
      if (insertError) {
        await admin.auth.admin.deleteUser(data.user.id);
        return reply({ error: insertError.code === '23505' ? 'That username is already in use.' : 'Could not save the station.' }, 409);
      }
      return reply({ station: created, password });
    }
    if (!['disable', 'enable', 'revoke', 'reset'].includes(body?.action) || !/^[0-9a-f-]{36}$/i.test(body?.id || '')) {
      return reply({ error: 'Invalid station action.' }, 400);
    }
    const { data: station, error: lookupError } = await admin.from('station_accounts')
      .select('id,user_id,username').eq('id', body.id).single();
    if (lookupError || !station) return reply({ error: 'Station not found.' }, 404);
    // Revoke first, before touching the provider password. A failed reset
    // leaves the station locked, never on an old supposedly-rotated password.
    const { data: changed, error } = await admin.rpc('manage_station_access', {
      p_actor: gate.user.id, p_station: body.id, p_action: body.action,
    });
    if (error) return reply({ error: 'Could not update station access. A password reset may already be in progress.' }, 409);
    if (body.action === 'reset') {
      const password = randomBytes(24).toString('base64url');
      const { error: resetError } = await admin.auth.admin.updateUserById(station.user_id, { password });
      if (resetError) return reply({ error: 'Password reset failed. Station access is locked; retry after five minutes.' }, 503);
      const { error: finishError } = await admin.rpc('manage_station_access', {
        p_actor: gate.user.id, p_station: body.id, p_action: 'finish_reset', p_epoch: changed.epoch,
      });
      if (finishError) return reply({ error: 'Reset was interrupted. Access remains locked; retry after five minutes.' }, 409);
      return reply({ username: station.username, password });
    }
    return reply({ ok: true });
  } catch { return reply({ error: 'Station management is unavailable. Refresh to verify the current state.' }, 503); }
}
