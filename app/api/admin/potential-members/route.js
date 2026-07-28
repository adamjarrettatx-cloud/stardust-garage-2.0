import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { validatePotentialMemberInput } from '@/lib/potential-members';

export const runtime = 'nodejs';

// GET: list potential members, most recently added first, with the adding
// admin's name/email attached so the UI can show "Added by <admin>".
export async function GET() {
  const { unauthorized } = await requireAdmin();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from('potential_members')
    .select(`
      id, full_name, phone, email, notes, status,
      added_by, converted_member_id, created_at, updated_at,
      added_by_team_member:added_by ( id, full_name, email )
    `)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ potentialMembers: data || [] });
}

// POST: create a new potential member profile, tagged with whichever admin
// created it (added_by = the caller's team_members.id, not their auth uid —
// keeps this consistent with how the rest of /bananas joins on team_members).
export async function POST(request) {
  const { user, unauthorized } = await requireAdmin();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const { valid, error: validationError, data } = validatePotentialMemberInput(body);
  if (!valid) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: callerTeamMember } = await admin
    .from('team_members')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();

  const { data: inserted, error: insertError } = await admin
    .from('potential_members')
    .insert({
      ...data,
      added_by: callerTeamMember?.id || null,
    })
    .select(`
      id, full_name, phone, email, notes, status,
      added_by, converted_member_id, created_at, updated_at,
      added_by_team_member:added_by ( id, full_name, email )
    `)
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ potentialMember: inserted }, { status: 201 });
}
