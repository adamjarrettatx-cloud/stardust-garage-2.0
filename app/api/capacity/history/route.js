import { NextResponse } from 'next/server';
import { requireTeam } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/capacity/history?limit=50
// Recent audit/history rows for the active session (or all sessions when
// ?all=1). Team-or-admin only; RLS restricts visibility.
export async function GET(request) {
  const { unauthorized } = await requireTeam();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 200);
  const all = searchParams.get('all') === '1';

  const supabase = await createClient();

  let sessionId = null;
  if (!all) {
    const { data: session } = await supabase
      .from('capacity_sessions')
      .select('id')
      .eq('is_active', true)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    sessionId = session?.id || null;
    if (!sessionId) return NextResponse.json({ events: [] });
  }

  let query = supabase
    .from('capacity_events')
    .select('id, session_id, action, delta, count_after, max_capacity, source, note, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (sessionId) query = query.eq('session_id', sessionId);

  const { data: events, error } = await query;
  if (error) {
    return NextResponse.json({ error: 'Failed to load history' }, { status: 500 });
  }
  return NextResponse.json({ events: events || [] });
}
