import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { getCurrentUser } from '@/lib/auth-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/notifications/unread-count
//
// Cheap: just a count. Bell icon polls this every 60s. Capped at 99+ so we
// don't chase big numbers for a badge.
export async function GET(request) {
  const { user } = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ count: 0 });

  const admin = createAdminClient();
  const { count, error } = await admin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null);

  if (error) {
    console.error('[notifications.unread-count]', error.message);
    return NextResponse.json({ count: 0 });
  }

  return NextResponse.json({ count: Math.min(count || 0, 99) });
}
