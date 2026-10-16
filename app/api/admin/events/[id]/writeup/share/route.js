import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSameOrigin } from '@/lib/manual-income';
import { loadEventWriteup } from '@/lib/event-writeup-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f-]{36}$/i;

// POST { action: 'share' | 'unshare' }
// Share freezes the organizer-safe view (lib/event-writeup organizerView) at
// this moment. Later edits never reach the organizer until shared again.
export async function POST(request, { params }) {
  if (!isSameOrigin(request.headers.get('origin'), request.headers.get('host'))) {
    return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
  }
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }
  const action = body?.action;
  if (action !== 'share' && action !== 'unshare') return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

  const admin = createAdminClient();
  const current = await loadEventWriteup(admin, id);
  if (!current) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  if (action === 'share') {
    if (!current.organizer) {
      return NextResponse.json({ error: 'Set this event\u2019s Organizer in the event editor before sharing.' }, { status: 409 });
    }
    if (current.writeup.organizerPercent == null) {
      return NextResponse.json({ error: 'Enter the organizer percentage and save before sharing.' }, { status: 409 });
    }
  }

  const patch = action === 'share'
    ? { organizer_snapshot: current.organizerPreview, shared_at: new Date().toISOString(), shared_by: user.id }
    : { organizer_snapshot: null, shared_at: null, shared_by: null };

  const { error: upErr } = await admin
    .from('event_writeups')
    .upsert({ event_id: id, created_by: user.id }, { onConflict: 'event_id', ignoreDuplicates: true });
  if (upErr) { console.error('[event.writeup.share.ensure]', upErr); return NextResponse.json({ error: 'Share failed' }, { status: 500 }); }
  const { error } = await admin.from('event_writeups').update({ ...patch, updated_by: user.id, updated_at: new Date().toISOString() }).eq('event_id', id);
  if (error) { console.error('[event.writeup.share]', error); return NextResponse.json({ error: 'Share failed' }, { status: 500 }); }

  const result = await loadEventWriteup(admin, id);
  return NextResponse.json({ ok: true, ...result });
}
