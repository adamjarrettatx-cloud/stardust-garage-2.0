import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { normalizeDepartmentTags } from '@/lib/progress';

export const runtime = 'nodejs';

// PATCH /api/admin/team-members/:id — set a member's department tags, which
// drive which tasks they can see (see can_read_task in
// supabase/migrations/20260729_team_member_department_tags.sql).
//
// Uses the user-context client so the "Admins can manage team members" RLS
// policy authorises the write — no service-role client needed.
export async function PATCH(request, { params }) {
  // Owner-only: department tags control task visibility, and this endpoint is
  // only reachable from the owner-only Team Members page.
  const { unauthorized } = await requireOwner();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.departments)) {
    return NextResponse.json({ error: 'departments must be an array.' }, { status: 400 });
  }

  const { departments, invalid } = normalizeDepartmentTags(body.departments);
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Invalid department: ${invalid.join(', ')}` },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('team_members')
    .update({ departments })
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: 'Team member not found.' }, { status: 404 });
  return NextResponse.json({ member: data });
}
