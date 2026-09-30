import { NextResponse } from 'next/server';
import { requireSecurityOrTeam } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadRoster } from '@/lib/capacity/arrival-roster-server';
export async function GET(request) {
  const gate = await requireSecurityOrTeam(request);
  const headers = { 'Cache-Control': 'private, no-store' };
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  const query = new URL(request.url).searchParams.get('q')?.trim() || '';
  if (query.length < 2 || query.length > 120) return NextResponse.json({ signins: [] }, { headers });
  try {
    const admin = createAdminClient();
    const { data: allowed, error } = await admin.rpc('consume_station_login_limit', {
      p_bucket: `guest-search:${gate.user.id}`, p_limit: 90, p_seconds: 60,
    });
    if (error || !allowed) return NextResponse.json({ error: 'Search temporarily unavailable. Please wait.' }, { status: error ? 503 : 429, headers });
    const { signins } = await loadRoster(admin, { query });
    // Security needs identity selection, not the full front-desk arrival export.
    return NextResponse.json({ signins: signins.slice(0, 30).map(({ id, kind, full_name }) => ({ id, kind, full_name })) }, { headers });
  } catch { return NextResponse.json({ error: 'Guest search unavailable.' }, { status: 503, headers }); }
}
