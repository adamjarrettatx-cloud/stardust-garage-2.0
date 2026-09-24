import { NextResponse } from 'next/server';
import { requireFrontDeskOrTeam } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { restrictionGuard } from '@/lib/capacity/access-restrictions';
import { UUID } from '@/lib/capacity/access-policy';
import { loadRoster } from '@/lib/capacity/arrival-roster-server';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const response = (body, status = 200) => NextResponse.json(body, { status, headers });
export async function POST(request) {
  const gate = await requireFrontDeskOrTeam();
  if (gate.unauthorized || !gate.user?.id) return response({ error: 'Unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return response({ error: 'Invalid JSON' }, 400); }
  if (!UUID.test(body?.id || '') || !['trial_pass','member','guest'].includes(body?.kind)) {
    return response({ error: 'A valid guest reference is required.' }, 400);
  }
  try {
    const admin = createAdminClient();
    const subject = { kind: body.kind, id: body.id };
    const roster = await loadRoster(admin, { subject });
    const person = roster.people.find(p => p.identityKeys.includes(`${body.kind}:${body.id}`));
    if (!person) return response({ error: 'Guest not found.' }, 404);
    // Check every explicitly linked credential, not just the displayed identity.
    // Otherwise selecting a member row could hide a ban on the linked trial.
    for (const row of person.group) {
      const blocked = await restrictionGuard(admin, { kind: row.kind, id: row.id });
      if (blocked) return blocked;
    }
    if (person.wire.checked_in_at) return response({ ok: true, alreadyCheckedIn: true, row: person.wire, shiftDay: roster.shiftDay });
    if (person.wire.admission_reason) return response({ error: person.wire.admission_reason }, 409);
    const { data, error } = await admin.rpc('front_desk_roster_check_in', {
      p_kind: person.wire.kind, p_id: person.wire.id, p_identity_keys: person.identityKeys,
      p_actor: gate.user.id, p_door_session_id: roster.context.session?.id || null,
    });
    if (error || !data?.arrival?.checked_in_at) {
      console.error('[front-desk.roster.checkin]', error);
      return response({ error: error?.code === 'P0001' ? error.message : 'Check-in could not be recorded. Hold entry and refresh before retrying.' }, 409);
    }
    const checkedAt = data.arrival.checked_in_at;
    // DB timestamp, never the browser's clock; duplicate retry keeps its place.
    return response({ ok: true, alreadyCheckedIn: data.alreadyCheckedIn, shiftDay: roster.shiftDay,
      row: { ...person.wire, checked_in_at: checkedAt, activity_at: checkedAt, activity_kind: 'check_in' } });
  } catch (error) {
    console.error('[front-desk.roster.checkin]', error.message);
    return response({ error: 'Guest verification is unavailable. Hold entry and retry.' }, 503);
  }
}
