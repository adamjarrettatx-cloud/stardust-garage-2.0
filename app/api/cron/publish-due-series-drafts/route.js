import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { publishEvent } from '@/lib/publish-event';
import { shouldPublishDraft } from '@/lib/publish-due-series-drafts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PUBLISHES_PER_RUN = 5;

// GET /api/cron/publish-due-series-drafts
// A series exposes one occurrence at a time, using the same cutoff the public
// listings use to decide that its predecessor has finished.
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: candidates, error: candidatesError } = await admin
    .from('events')
    .select('*')
    .eq('status', 'draft')
    .not('series_id', 'is', null)
    .gt('recurrence_position', 1)
    .order('event_date');
  if (candidatesError) return NextResponse.json({ error: candidatesError.message }, { status: 500 });

  const published = [];
  const skipped = [];
  for (const draft of candidates || []) {
    if (published.length >= MAX_PUBLISHES_PER_RUN) {
      skipped.push({ eventId: draft.id, reason: 'safety_cap_reached' });
      continue;
    }

    const { data: series, error: seriesError } = await admin
      .from('event_series')
      .select('*')
      .eq('id', draft.series_id)
      .eq('is_active', true)
      .maybeSingle();
    if (seriesError) {
      console.error('[publish-due-series-drafts] series lookup failed', { eventId: draft.id, error: seriesError.message });
      skipped.push({ eventId: draft.id, reason: 'series_lookup_failed' });
      continue;
    }
    if (!series) {
      skipped.push({ eventId: draft.id, reason: 'series_inactive_or_missing' });
      continue;
    }

    const { data: previousSibling, error: previousError } = await admin
      .from('events')
      .select('*')
      .eq('series_id', draft.series_id)
      .eq('recurrence_position', draft.recurrence_position - 1)
      .maybeSingle();
    if (previousError) {
      console.error('[publish-due-series-drafts] sibling lookup failed', { eventId: draft.id, error: previousError.message });
      skipped.push({ eventId: draft.id, reason: 'previous_sibling_lookup_failed' });
      continue;
    }
    if (!shouldPublishDraft(draft, previousSibling, new Date())) {
      skipped.push({ eventId: draft.id, reason: previousSibling ? 'previous_occurrence_not_finished' : 'previous_sibling_missing' });
      continue;
    }

    const result = await publishEvent(admin, draft.id, { via: 'cron' });
    published.push({ eventId: draft.id, status: result.status, ok: result.status === 200 });
    console.log('[publish-due-series-drafts] publish result', {
      eventId: draft.id,
      status: result.status,
      ok: result.status === 200,
    });
  }

  return NextResponse.json({
    ok: true,
    attempted: published.length,
    published,
    skipped,
    safetyCap: MAX_PUBLISHES_PER_RUN,
  });
}
