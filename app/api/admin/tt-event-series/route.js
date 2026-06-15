import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { listEventSeries } from '@/lib/tickettailor';

export const runtime = 'nodejs';

// GET /api/admin/tt-event-series
// Returns [{ id, name }] of TicketTailor event series. Admin only.
export async function GET() {
  try {
    const { unauthorized, reason } = await requireAdminMfa();
    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
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
