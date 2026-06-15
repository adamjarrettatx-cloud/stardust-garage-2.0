import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';

export async function POST(request) {
  // Verify caller is an admin via team_members (server-controlled).
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  }

  const { id } = await request.json();
  if (!id) {
    return NextResponse.json({ error: 'Member ID required.' }, { status: 400 });
  }

  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Get the member record first so we can clean up auth user if needed
  const { data: member } = await adminSupabase
    .from('team_members')
    .select('user_id, role')
    .eq('id', id)
    .single();

  // Remove from team_members table
  const { error: delErr } = await adminSupabase
    .from('team_members')
    .delete()
    .eq('id', id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 400 });
  }

  // Optionally delete the auth user entirely if they're a team-only member
  // (admins may have other reasons to keep their auth account)
  if (member?.user_id && member.role === 'team') {
    await adminSupabase.auth.admin.deleteUser(member.user_id);
  }

  return NextResponse.json({ success: true });
}
