import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireTeam } from '@/lib/auth-helpers';
import { closeActiveDoorSession } from '@/lib/door-session';

// POST /api/door-session/end
//
// Body: { notes?: string }
//
// Closes whatever door session is currently open. Idempotent: closing
// when nothing is open returns { ok: true, alreadyClosed: true }.
//
// Any team member may close a session — the door often changes hands
// mid-shift, and blocking on "only opener can close" would strand it.
//
// Auth: team member (team OR admin).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const { user, unauthorized } = await requireTeam();
  if (unauthorized || !user) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    // Body is optional here.
  }

  const notes = typeof body?.notes === 'string' ? body.notes : '';

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const result = await closeActiveDoorSession(admin, {
    closedBy: user.id,
    notes,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 });
  }

  return NextResponse.json({
    session: result.session,
    alreadyClosed: Boolean(result.alreadyClosed),
  });
}
