import { NextResponse } from 'next/server';
import { requireFrontDeskOrTeam } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { restrictionGuard } from '@/lib/capacity/access-restrictions';
import { UUID } from '@/lib/capacity/access-policy';
import { CAPACITY_OPERATIONS } from '@/lib/capacity-utils';

export const dynamic = 'force-dynamic';
export async function POST(request) {
  const gate = await requireFrontDeskOrTeam();
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!UUID.test(body?.id || '')) return NextResponse.json({ error: 'Pass required' }, { status: 400 });
  const blocked = await restrictionGuard(createAdminClient(), { kind: 'trial_pass', id: body.id });
  if (blocked) return blocked;
  // Preserve the roster's capacity-only behavior, but authorize this named
  // admission server-side before the capacity RPC can run.
  const client = await createClient();
  const { error } = await client.rpc(CAPACITY_OPERATIONS.check_in.rpc, {
    p_source: CAPACITY_OPERATIONS.check_in.defaultSource,
    p_note: 'front_desk laptop (trial-pass roster check-in)',
  });
  if (error) return NextResponse.json({ error: 'Access check passed, but capacity could not be updated. Check the capacity session before retrying.' }, { status: 409 });
  return NextResponse.json({ ok: true });
}
