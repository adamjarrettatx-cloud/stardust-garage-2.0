import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureNextOccurrenceDraft } from '@/lib/series-generation';

export const runtime = 'nodejs';

// POST /api/admin/series/backfill-next-drafts
// Deployment-safe one-shot: it reuses the production generation primitive,
// avoiding a brittle SQL clone of event and ticket-product columns.
export async function POST() {
  try {
    const { unauthorized, reason } = await requireAdminMfa();
    if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });

    const admin = createAdminClient();
    const { data: seriesRows, error: seriesError } = await admin
      .from('event_series')
      .select('*')
      .eq('is_active', true)
      .order('created_at');
    if (seriesError) return NextResponse.json({ error: seriesError.message }, { status: 500 });

    const generated = [];
    const skipped = [];
    const failed = [];
    for (const series of seriesRows || []) {
      // A draft is intentionally not a predecessor: this endpoint is
      // re-runnable without ever putting the team calendar two ahead.
      const { data: latestPublished, error: latestError } = await admin
        .from('events')
        .select('*')
        .eq('series_id', series.id)
        .eq('status', 'published')
        .order('event_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) {
        failed.push({ seriesId: series.id, error: latestError.message });
        continue;
      }
      if (!latestPublished) {
        skipped.push({ seriesId: series.id, reason: 'no_published_occurrence' });
        continue;
      }

      try {
        const result = await ensureNextOccurrenceDraft(admin, series, { previousEvent: latestPublished });
        const entry = { seriesId: series.id, ...result };
        if (result.created) generated.push(entry);
        else skipped.push(entry);
      } catch (error) {
        console.error('[backfill-next-drafts] failed', { seriesId: series.id, error: error?.message || error });
        failed.push({ seriesId: series.id, error: error?.message || String(error) });
      }
    }

    return NextResponse.json({ ok: failed.length === 0, generated, skipped, failed });
  } catch (error) {
    console.error('series/backfill-next-drafts route error:', error);
    return NextResponse.json({ error: 'Failed to backfill series drafts' }, { status: 500 });
  }
}
