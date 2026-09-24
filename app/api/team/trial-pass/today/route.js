import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireFrontDeskOrTeam } from '@/lib/auth-helpers';
import { loadRoster } from '@/lib/capacity/arrival-roster-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

// Empty search = tonight's merged newest-first signup/admission stream.
// Search = all historical visitor identities, never a filter of tonight alone.
export async function GET(request) {
  const { unauthorized } = await requireFrontDeskOrTeam();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  const query = new URL(request.url).searchParams.get('q')?.trim() || '';
  if (query.length > 120) return NextResponse.json({ error: 'Use a name of up to 120 characters.' }, { status: 400, headers });
  if (query && query.length < 2) return NextResponse.json({ signins: [], minimumQueryLength: 2 }, { headers });
  try {
    const { signins, shiftDay, since, truncated } = await loadRoster(createAdminClient(), { query });
    return NextResponse.json({ signins, shiftDay, since, truncated }, { headers });
  } catch (error) {
    console.error('[front-desk.roster]', error.message);
    return NextResponse.json({ error: error.message || 'Could not load the arrival roster.' }, { status: 503, headers });
  }
}
