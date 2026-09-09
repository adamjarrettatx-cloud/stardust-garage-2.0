import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { getCurrentUser } from '@/lib/auth-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/notifications?limit=50&before=<ISO>
//
// Returns the current user's notification feed, newest first. Cursor
// pagination via ?before=<created_at ISO> for infinite scroll.
export async function GET(request) {
  const { user } = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ items: [], next_cursor: null });

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);
  const before = url.searchParams.get('before');

  const admin = createAdminClient();
  let q = admin
    .from('notifications')
    .select('id, type, title, body, data, read_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) q = q.lt('created_at', before);

  const { data, error } = await q;
  if (error) {
    console.error('[notifications.list]', error.message);
    return NextResponse.json({ error: 'Failed to load feed' }, { status: 500 });
  }

  return NextResponse.json({
    items: data || [],
    next_cursor: data && data.length === limit ? data[data.length - 1].created_at : null,
  });
}
