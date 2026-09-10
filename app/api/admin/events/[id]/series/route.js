import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f-]{36}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FREQUENCIES = new Set(['weekly', 'biweekly']);

function slugify(value) {
  return String(value || 'event-series')
    .toLowerCase().trim().replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '') || 'event-series';
}

async function availableSlug(admin, title, currentId = null) {
  const base = slugify(title);
  for (let n = 1; n < 100; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const { data } = await admin.from('event_series').select('id').eq('slug', slug).maybeSingle();
    if (!data || data.id === currentId) return slug;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

// POST /api/admin/events/:id/series
// The event is already saved by the editor. This endpoint owns the privileged
// series write so client-side form state cannot create or link arbitrary rows.
export async function POST(request, { params }) {
  try {
    const gate = await requireAdminMfa();
    if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized', reason: gate.reason }, { status: 401 });

    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: 'Bad event id' }, { status: 400 });
    const body = await request.json();
    const recurrenceFreq = body?.recurrence_freq;
    const startsOn = body?.starts_on;
    const endsOn = body?.ends_on || null;
    if (!FREQUENCIES.has(recurrenceFreq) || !DATE.test(startsOn) || (endsOn && !DATE.test(endsOn))) {
      return NextResponse.json({ error: 'Invalid recurrence schedule' }, { status: 400 });
    }
    if (endsOn && endsOn < startsOn) return NextResponse.json({ error: 'End date must be on or after the first occurrence' }, { status: 400 });

    const admin = createAdminClient();
    const { data: event, error: eventError } = await admin.from('events').select('id, title, event_date, series_id').eq('id', id).single();
    if (eventError || !event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (event.event_date !== startsOn && !event.series_id) {
      return NextResponse.json({ error: 'The first occurrence date must match this event date' }, { status: 400 });
    }

    const weekday = new Date(`${startsOn}T00:00:00.000Z`).getUTCDay();
    let seriesId = event.series_id;
    if (seriesId) {
      const { error } = await admin.from('event_series').update({
        title: event.title, recurrence_freq: recurrenceFreq, recurrence_weekday: weekday,
        starts_on: startsOn, ends_on: endsOn, is_active: true,
      }).eq('id', seriesId);
      if (error) throw error;
    } else {
      const slug = await availableSlug(admin, event.title);
      const { data: series, error } = await admin.from('event_series').insert({
        title: event.title, slug, recurrence_freq: recurrenceFreq, recurrence_weekday: weekday,
        starts_on: startsOn, ends_on: endsOn, template_event_id: event.id,
      }).select('id').single();
      if (error) throw error;
      seriesId = series.id;
      const { error: linkError } = await admin.from('events').update({ series_id: seriesId, recurrence_position: 1 }).eq('id', event.id);
      if (linkError) throw linkError;
    }

    return NextResponse.json({ success: true, series_id: seriesId });
  } catch (error) {
    console.error('events/[id]/series route error:', error);
    return NextResponse.json({ error: 'Failed to save recurrence' }, { status: 500 });
  }
}
