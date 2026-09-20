import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { requireFrontDeskOrTeam } from '@/lib/auth-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/team/trial-pass/today
//
// The chronological "who signed up tonight" feed powering the Front Desk
// Tonight's Sign-Ins panel. Rolling 12-hour window matches the same
// convention /api/capacity/checkins falls back to when no door session is
// open: it captures the current evening without replaying yesterday's guests.
//
// Only display-safe fields are returned (full_name, issued_at, activated_at,
// status). Phone and email are intentionally omitted -- the door attendant
// just needs to visually match a walk-up to the list.
//
// Why service-role: trial_passes is admin-only under RLS but the door is
// worked by team members who are not admins. requireFrontDeskOrTeam() gates the route
// and the narrow projection below prevents PII leaks. Same contract used by
// /api/capacity/checkins.

const WINDOW_MS = 12 * 60 * 60 * 1000; // 12 hours
const MAX_ROWS = 500;

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ signins: [] });
  }

  const { unauthorized } = await requireFrontDeskOrTeam();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  const { data, error } = await admin
    .from('trial_passes')
    .select('id, full_name, issued_at, activated_at, status')
    .gte('issued_at', since)
    .order('issued_at', { ascending: true })
    .limit(MAX_ROWS);

  if (error) {
    return NextResponse.json(
      { error: 'Could not load tonight’s sign-ins.' },
      { status: 500 },
    );
  }

  const signins = (data || []).map((row) => ({
    id: row.id,
    full_name: row.full_name || 'Guest',
    issued_at: row.issued_at,
    activated_at: row.activated_at,
    status: row.status,
  }));

  return NextResponse.json({ signins, since });
}
