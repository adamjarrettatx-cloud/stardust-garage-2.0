import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { requireAdmin } from '@/lib/auth-helpers';
import { notifyMany } from '@/lib/notifications/send';
import { listAllMemberUserIds } from '@/lib/notifications/resolve-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/admin/notifications/broadcast
//
// Send a notification to every member (or every active member). Used by
// admin to announce a new event, a schedule change, a house update. Type
// defaults to 'event_published' but any type id is accepted.
//
// Body: {
//   title:  string  (required)
//   body:   string  (optional)
//   url:    string  (optional \u2014 deep link)
//   type:   string  (optional \u2014 defaults to 'event_published')
//   activeOnly: boolean (optional \u2014 default false)
//   eventId: string (optional \u2014 stored on data for deep linking)
// }
export async function POST(request) {
  const { user, unauthorized } = await requireAdmin(request);
  if (unauthorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true, sent: 0 });

  let body = {};
  try { body = await request.json(); } catch {}
  const title = String(body?.title || '').trim();
  const bodyText = body?.body ? String(body.body).trim() : null;
  const url = body?.url ? String(body.url) : null;
  const type = String(body?.type || 'event_published');
  const activeOnly = Boolean(body?.activeOnly);
  const eventId = body?.eventId || null;

  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });

  const admin = createAdminClient();
  const userIds = await listAllMemberUserIds(admin, { activeOnly });
  if (userIds.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, note: 'No recipients' });
  }

  const data = { url };
  if (eventId) data.event_id = eventId;

  const results = await notifyMany(admin, userIds, {
    type,
    title,
    body: bodyText,
    data,
  });

  const okCount = results.filter((r) => r.ok).length;
  console.log('[admin.notifications.broadcast]', { by: user.id, type, recipients: userIds.length, ok: okCount });

  return NextResponse.json({ ok: true, sent: okCount, total: userIds.length });
}
