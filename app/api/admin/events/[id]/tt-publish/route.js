import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { publishEvent } from '@/lib/publish-event';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f-]{36}$/i;

// POST /api/admin/events/:id/tt-publish[?force=1]
// Authentication stays at the route boundary; the shared primitive keeps this
// manual path and the trusted cron on one audited publication behavior.
export async function POST(request, { params }) {
  try {
    const { user, unauthorized, reason } = await requireAdminMfa();
    if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });

    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: 'Bad event id' }, { status: 400 });

    const result = await publishEvent(createAdminClient(), id, {
      via: 'admin',
      force: new URL(request.url).searchParams.get('force') === '1',
      actorUserId: user.id,
    });
    return NextResponse.json(result.body, { status: result.status, headers: result.headers });
  } catch (err) {
    console.error('events/[id]/tt-publish route error:', err);
    return NextResponse.json({ error: `Server error: ${err?.message || 'unknown'}` }, { status: 500 });
  }
}
