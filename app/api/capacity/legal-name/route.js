import { NextResponse } from 'next/server';
import { requireFrontDeskOrTeam } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { UUID } from '@/lib/capacity/access-policy';
import { validateLegalName } from '@/lib/legal-name';

export const dynamic = 'force-dynamic';
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request) {
  const gate = await requireFrontDeskOrTeam(request);
  if (gate.unauthorized) return reply({ error: 'Unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return reply({ error: 'Invalid JSON' }, 400); }
  const name = validateLegalName(body?.fullName);
  if (!name.valid) return reply({ error: name.error }, 400);
  if (!['trial_pass', 'member', 'ticket', 'guestlist'].includes(body?.subject?.kind)
    || !UUID.test(body?.subject?.id || '') || typeof body?.expectedName !== 'string'
    || body.expectedName.length > 500 || body.idChecked !== true
    || typeof body?.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) {
    return reply({ error: 'Choose a guest, check their ID, and enter a correction reason.' }, 400);
  }
  try {
    const { data, error } = await createAdminClient().rpc('correct_legal_name', {
      p_actor: gate.user.id, p_kind: body.subject.kind, p_id: body.subject.id,
      p_expected_name: body.expectedName, p_name: name.fullName, p_reason: body.reason.trim(),
    });
    if (error) {
      if (error.code === '42501') return reply({ error: 'You are not authorized to edit names.' }, 403);
      if (error.code === 'P0002') return reply({ error: 'Guest not found. Refresh and try again.' }, 404);
      return reply({ error: 'Could not save the correction. Refresh the guest and retry; ask an admin if it persists.' }, 409);
    }
    return reply({ ok: true, ...data });
  } catch {
    return reply({ error: 'Name correction unavailable. Nothing was confirmed saved; refresh before retrying.' }, 503);
  }
}
