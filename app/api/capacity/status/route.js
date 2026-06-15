import { NextResponse } from 'next/server';
import { requireTeam } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { deriveStatus } from '@/lib/capacity-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/capacity/status
// Returns the active session + derived status. Team-or-admin only. Reads go
// through the user-scoped (RLS-aware) client; the capacity_sessions_team_select
// policy already restricts this to team members.
export async function GET() {
  const { unauthorized } = await requireTeam();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await createClient();
  const { data: session, error } = await supabase
    .from('capacity_sessions')
    .select('id, name, max_capacity, current_count, is_active, started_at, ended_at, updated_at')
    .eq('is_active', true)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Failed to load status' }, { status: 500 });
  }

  return NextResponse.json({ session: session || null, status: deriveStatus(session) });
}
