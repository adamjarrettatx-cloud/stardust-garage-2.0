import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { listEventSeries } from '@/lib/tickettailor';

export const runtime = 'nodejs';

// GET /api/admin/tt-event-series
// Returns [{ id, name }] of TicketTailor event series. Admin only.
export async function GET() {
  try {
    const serverClient = await createServerClient();
    const { data: { user: adminUser } } = await serverClient.auth.getUser();
    if (!adminUser || !adminUser.user_metadata?.is_admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const series = await listEventSeries();
    return NextResponse.json({ series });
  } catch (err) {
    console.error('tt-event-series route error:', err);
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || 'unknown') },
      { status: 500 }
    );
  }
}
