import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { getCurrentUser } from '@/lib/auth-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PATCH /api/notifications/:id  { read: true }
//
// Mark a single notification as read (or unread). Route enforces
// ownership \u2014 users can only touch their own rows.
export async function PATCH(request, context) {
  const { user } = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });

  const params = await context.params;
  const id = params?.id;
  if (!id || !UUID.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  let body = {};
  try { body = await request.json(); } catch { /* empty body treated as { read: true } */ }
  const shouldMarkRead = body?.read !== false; // default true

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('notifications')
    .update({ read_at: shouldMarkRead ? new Date().toISOString() : null })
    .eq('id', id)
    .eq('user_id', user.id) // ownership guard
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[notifications.patch]', error.message);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ ok: true, id });
}
