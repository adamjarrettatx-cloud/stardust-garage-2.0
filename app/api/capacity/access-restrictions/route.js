import { NextResponse } from 'next/server';
import { requireFrontDeskOrTeam } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { accessStatus, resolveAccessSubject, resolveAccessIdentity } from '@/lib/capacity/access-restrictions';
import { UUID, contactKeys, validateRestriction } from '@/lib/capacity/access-policy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const reply = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request) {
  const gate = await requireFrontDeskOrTeam(request);
  if (gate.unauthorized) return reply({ error: 'Unauthorized' }, 401);
  try {
    const admin = createAdminClient();
    const params = new URL(request.url).searchParams;
    if (params.get('subjectId')) {
      return reply(await accessStatus(admin, { kind: params.get('kind'), id: params.get('subjectId') }));
    }
    const { data: manager, error: managerError } = await admin.from('access_restriction_managers')
      .select('user_id,can_manage_permissions').eq('user_id', gate.user.id).maybeSingle();
    if (managerError) throw managerError;
    let query = admin.from('access_restrictions').select('*').order('created_at', { ascending: false });
    const search = (params.get('q') || '').trim().slice(0, 160).replace(/[%_\\]/g, '');
    if (search) query = query.ilike('full_name', `%${search}%`);
    if (params.get('history') !== '1') {
      query = query.is('lifted_at', null).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
    }
    const page = Math.max(0, Math.min(10000, Number.parseInt(params.get('page') || '0', 10) || 0));
    const { data: rows, error } = await query.range(page * 50, page * 50 + 49);
    if (error) throw error;
    let events = [];
    if (rows.length) {
      const result = await admin.from('access_restriction_events').select('*').in('restriction_id', rows.map(r => r.id))
        .order('created_at', { ascending: false }).limit(1000);
      if (result.error) throw result.error;
      events = result.data;
    }
    let staff = [];
    if (manager?.can_manage_permissions) {
      const [people, managers] = await Promise.all([
        admin.from('team_members').select('user_id,full_name,role').in('role', ['admin', 'team', 'front_desk']).not('user_id', 'is', null),
        admin.from('access_restriction_managers').select('user_id,can_manage_permissions'),
      ]);
      if (people.error || managers.error) throw new Error('Permissions unavailable');
      staff = people.data.map(p => ({ ...p, authorized: managers.data.some(m => m.user_id === p.user_id),
        permissionOwner: managers.data.some(m => m.user_id === p.user_id && m.can_manage_permissions) }));
    }
    return reply({ rows: rows.map(r => ({ ...r, events: events.filter(e => e.restriction_id === r.id) })),
      canLift: Boolean(manager), canManagePermissions: Boolean(manager?.can_manage_permissions), staff, page });
  } catch {
    return reply({ error: 'Could not load access restrictions. Hold entry until the check is available.' }, 503);
  }
}

export async function POST(request) {
  const gate = await requireFrontDeskOrTeam(request);
  if (gate.unauthorized) return reply({ error: 'Unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return reply({ error: 'Invalid JSON' }, 400); }
  const action = body?.action;
  if (!['check', 'create', 'note', 'lift', 'same_person', 'different_person', 'manager'].includes(action)) return reply({ error: 'Invalid action' }, 400);
  const admin = createAdminClient();
  if (action === 'check') {
    try { return reply(await accessStatus(admin, body.subject, body.extra)); }
    catch { return reply({ error: 'Access check unavailable. Hold entry and retry.' }, 503); }
  }
  let payload;
  try {
    if (action === 'manager') {
      const { data: permissionOwner, error } = await admin.from('access_restriction_managers')
        .select('can_manage_permissions').eq('user_id', gate.user.id).maybeSingle();
      if (error || !permissionOwner?.can_manage_permissions) return reply({ error: 'Only the permission owner can change this list.' }, 403);
      if (!UUID.test(body.user_id || '') || typeof body.enabled !== 'boolean') throw new Error('Choose a staff member.');
      payload = { user_id: body.user_id, enabled: body.enabled };
    } else if (action === 'create') {
      validateRestriction(body);
      const identity = body.subject ? await resolveAccessSubject(admin, body.subject) : null;
      payload = {
        full_name: body.full_name.trim(), kind: body.kind, reason: body.reason.trim(),
        identifying_details: body.identifying_details?.trim() || '',
        expires_at: body.kind === 'temporary' ? new Date(body.expires_at).toISOString() : null,
        match_keys: [...new Set([...contactKeys(body), ...(identity?.match_keys || [])])],
        identity_keys: identity?.identity_keys || [],
      };
    } else {
      if (!UUID.test(body.id || '') || typeof body.comment !== 'string' || !body.comment.trim() || body.comment.length > 2000) {
        throw new Error('A restriction and a note of up to 2,000 characters are required.');
      }
      payload = { id: body.id, comment: body.comment.trim() };
      if (action === 'same_person' || action === 'different_person') {
        const status = await accessStatus(admin, body.subject, body.extra);
        if (!status.matches.some(r => r.id === body.id)) throw new Error('No current match for this guest. Refresh first.');
        const identity = await resolveAccessIdentity(admin, body.subject, body.extra);
        payload.identity_keys = identity.identity_keys;
        payload.subject_key = identity.subject_key;
      }
    }
  } catch (error) {
    return reply({ error: error.message || 'Invalid request' }, 400);
  }
  const { data, error } = await admin.rpc('manage_access_restriction', { p_actor: gate.user.id, p_action: action, p_data: payload });
  if (error) return reply({ error: error.code === '42501' ? 'Only the owner or an authorized manager can perform this action.' : 'Could not save. Refresh and try again.' }, error.code === '42501' ? 403 : 409);
  return reply({ ok: true, id: data });
}
