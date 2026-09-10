import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildNextOccurrenceEvent, buildNextTicketProductPayload, nextOccurrenceDate } from '@/lib/event-series';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function freshShareToken() {
  return randomBytes(24).toString('base64url');
}

async function cloneProducts(admin, templateEventId, newEventId) {
  const { data: products, error } = await admin.from('ticket_products').select('*').eq('event_id', templateEventId).order('display_order');
  if (error) throw error;
  for (const source of products || []) {
    const [{ data: inventory, error: inventoryError }, { data: tiers, error: tiersError }] = await Promise.all([
      admin.from('ticket_inventory').select('*').eq('product_id', source.id).maybeSingle(),
      admin.from('ticket_price_tiers').select('*').eq('product_id', source.id).order('display_order'),
    ]);
    if (inventoryError || tiersError) throw inventoryError || tiersError;
    const payload = buildNextTicketProductPayload(source, inventory, tiers, newEventId);
    const { data: product, error: productError } = await admin.from('ticket_products').insert(payload.product).select('id').single();
    if (productError) throw productError;
    if (payload.inventory) {
      const { error: insertInventoryError } = await admin.from('ticket_inventory').insert({ product_id: product.id, ...payload.inventory });
      if (insertInventoryError) throw insertInventoryError;
    }
    if (payload.tiers.length) {
      const { error: tiersInsertError } = await admin.from('ticket_price_tiers').insert(payload.tiers.map((tier) => ({ ...tier, product_id: product.id })));
      if (tiersInsertError) throw tiersInsertError;
    }
  }
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
    const eventDate = nextOccurrenceDate(latest.event_date, series.recurrence_freq, series.ends_on);
    if (!eventDate) {
      skipped.push({ seriesId: series.id, reason: 'series_end_reached' });
      continue;
    }

    // The template, rather than the latest draft, is canonical. This keeps
    // the schedule stable while allowing a one-off occurrence edit to stay local.
    const { data: template, error: templateError } = await admin.from('events').select('*').eq('id', series.template_event_id).single();
    if (templateError || !template) return NextResponse.json({ error: `Template missing for series ${series.id}` }, { status: 500 });
    const payload = buildNextOccurrenceEvent(template, {
      eventDate, seriesId: series.id, recurrencePosition: (latest.recurrence_position || 0) + 1,
      shareToken: freshShareToken(),
    });
    const { data: created, error: createError } = await admin.from('events').insert(payload).select('*').single();
    if (createError) {
      // The unique series/date index makes a duplicate cron invocation safe.
      if (createError.code === '23505') {
        skipped.push({ seriesId: series.id, reason: 'already_generated' });
        continue;
      }
      return NextResponse.json({ error: createError.message }, { status: 500 });
    }
    try {
      await cloneProducts(admin, template.id, created.id);
      const { error: logError } = await admin.from('series_generation_log').insert({
        series_id: series.id, event_id: created.id, template_event_id: template.id,
        previous_event_id: latest.id, generated_for: eventDate,
      });
      if (logError) throw logError;
    } catch (error) {
      await admin.from('events').delete().eq('id', created.id);
      return NextResponse.json({ error: `Failed to clone ${series.title}: ${error.message}` }, { status: 500 });
    }
    generated.push({ seriesId: series.id, eventId: created.id, eventDate });
  }

  console.log('event series occurrence generation', { today, generated, skipped });
  return NextResponse.json({ ok: true, today, generated, skipped });
}
