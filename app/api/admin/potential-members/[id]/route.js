import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildPotentialMemberUpdates } from '@/lib/potential-members';

export const runtime = 'nodejs';

// PATCH: update a potential member's status and/or contact details/notes.
export async function PATCH(request, { params }) {
  const { unauthorized } = await requireAdmin();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);

  const { error: buildError, updates } = buildPotentialMemberUpdates(body);
  if (buildError) {
    return NextResponse.json({ error: buildError }, { status: 400 });
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: updated, error } = await admin
    .from('potential_members')
    .update(updates)
    .eq('id', id)
    .select(`
      id, full_name, phone, email, notes, status,
      added_by, converted_member_id, created_at, updated_at,
      added_by_team_member:added_by ( id, full_name, email )
    `)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ potentialMember: updated });
}

// DELETE: remove a potential member entry (e.g. added by mistake / duplicate).
export async function DELETE(_request, { params }) {
  const { unauthorized } = await requireAdmin();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  const { error } = await admin
    .from('potential_members')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
