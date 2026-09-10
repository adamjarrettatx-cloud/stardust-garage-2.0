import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureNextOccurrenceDraft } from '@/lib/series-generation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = todayUtc();
  const { data: seriesRows, error: seriesError } = await admin
    .from('event_series').select('*').eq('is_active', true).order('created_at');
  if (seriesError) return NextResponse.json({ error: seriesError.message }, { status: 500 });

  const generated = [];
  const skipped = [];
  for (const series of seriesRows || []) {
    const { data: latest, error: latestError } = await admin
      .from('events').select('*').eq('series_id', series.id).order('event_date', { ascending: false }).limit(1).maybeSingle();
    if (latestError) return NextResponse.json({ error: latestError.message }, { status: 500 });
    if (!latest || today < latest.event_date) {
      skipped.push({ seriesId: series.id, reason: 'next_occurrence_already_scheduled' });
      continue;
    }
    try {
      const result = await ensureNextOccurrenceDraft(admin, series, { previousEvent: latest });
      if (result.created) generated.push({ seriesId: series.id, eventId: result.eventId, eventDate: result.eventDate });
      else skipped.push({ seriesId: series.id, reason: result.reason });
    } catch (error) {
      return NextResponse.json({ error: `Failed to clone ${series.title}: ${error.message}` }, { status: 500 });
    }
  }

  console.log('event series occurrence generation', { today, generated, skipped });
  return NextResponse.json({ ok: true, today, generated, skipped });
}
