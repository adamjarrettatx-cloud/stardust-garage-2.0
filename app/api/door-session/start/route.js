import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireTeam } from '@/lib/auth-helpers';
import { openDoorSession } from '@/lib/door-session';

// POST /api/door-session/start
//
// Body: { event_id: string, notes?: string }
//
// Opens a new door session for the given event. Only one session may be
// open at a time; if one already is, returns 409 with the active session
// so the client can prompt "End current shift first?".
//
// Auth: team member (team OR admin).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const { user, unauthorized } = await requireTeam();
  if (unauthorized || !user) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventId = typeof body?.event_id === 'string' ? body.event_id.trim() : '';
  const notes = typeof body?.notes === 'string' ? body.notes : '';

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const result = await openDoorSession(admin, {
    eventId,
    openedBy: user.id,
    notes,
  });

  if (!result.ok) {
    const payload = { error: result.error };
    if (result.activeSession) payload.active_session = result.activeSession;
    return NextResponse.json(payload, { status: result.status || 500 });
  }

  return NextResponse.json({
    session: result.session,
    event: result.event,
  });
}
