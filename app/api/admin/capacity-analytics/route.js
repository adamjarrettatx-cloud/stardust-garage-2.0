import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadCapacityAnalytics } from '@/lib/capacity/analytics-loader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  try {
    const result = await loadCapacityAnalytics(createAdminClient(), new URL(request.url).searchParams);
    return NextResponse.json(result, {
      status: result.status || 200,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    console.error('[capacity-analytics]', error.message);
    return NextResponse.json({ error: 'Unable to load complete capacity history. Please retry.' }, {
      status: 500, headers: { 'Cache-Control': 'private, no-store' },
    });
  }
}
