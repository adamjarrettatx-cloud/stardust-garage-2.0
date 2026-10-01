import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import { loadDoorEvents, DOOR_CACHE_HEADERS } from '@/lib/events/door-events-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// No user-supplied event ID, clock, preview or share-token overrides.
export async function GET() {
  try {
    const data = await loadDoorEvents(createAdminClient(), { ticketingEnabled: isInternalTicketingEnabled() });
    return NextResponse.json(data, { headers: DOOR_CACHE_HEADERS });
  } catch {
    return NextResponse.json({ error: 'Unable to check the current event. Please ask the door team.' },
      { status: 503, headers: DOOR_CACHE_HEADERS });
  }
}
