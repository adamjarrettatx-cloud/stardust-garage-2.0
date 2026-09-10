import { randomBytes } from 'node:crypto';
import {
  buildNextOccurrenceEvent,
  buildNextTicketProductPayload,
  nextOccurrenceDate,
} from './event-series.js';

function freshShareToken() {
  return randomBytes(24).toString('base64url');
}

async function cloneProducts(admin, templateEventId, newEventId) {
  const { data: products, error } = await admin
    .from('ticket_products')
    .select('*')
    .eq('event_id', templateEventId)
    .order('display_order');
  if (error) throw error;

  for (const source of products || []) {
    const [{ data: inventory, error: inventoryError }, { data: tiers, error: tiersError }] = await Promise.all([
      admin.from('ticket_inventory').select('*').eq('product_id', source.id).maybeSingle(),
      admin.from('ticket_price_tiers').select('*').eq('product_id', source.id).order('display_order'),
    ]);
    if (inventoryError || tiersError) throw inventoryError || tiersError;

    const payload = buildNextTicketProductPayload(source, inventory, tiers, newEventId);
    const { data: product, error: productError } = await admin
      .from('ticket_products')
      .insert(payload.product)
      .select('id')
      .single();
    if (productError) throw productError;

    if (payload.inventory) {
      const { error: insertInventoryError } = await admin
        .from('ticket_inventory')
        .insert({ product_id: product.id, ...payload.inventory });
      if (insertInventoryError) throw insertInventoryError;
    }
    if (payload.tiers.length) {
      const { error: tiersInsertError } = await admin
        .from('ticket_price_tiers')
        .insert(payload.tiers.map((tier) => ({ ...tier, product_id: product.id })));
      if (tiersInsertError) throw tiersInsertError;
    }
  }
}

export function makeEnsureNextOccurrenceDraft({
  createShareToken = freshShareToken,
  cloneOccurrenceProducts = cloneProducts,
} = {}) {
  return async function ensureNextOccurrenceDraft(admin, series, { previousEvent }) {
    if (!series?.is_active) return { created: false, reason: 'series_inactive' };
    if (!previousEvent?.id || !previousEvent?.event_date) {
      return { created: false, reason: 'previous_event_missing' };
    }

    const eventDate = nextOccurrenceDate(
      previousEvent.event_date,
      series.recurrence_freq,
      series.ends_on,
    );
    if (!eventDate) return { created: false, reason: 'series_end_reached' };

    const { data: existing, error: existingError } = await admin
      .from('events')
      .select('id, event_date')
      .eq('series_id', series.id)
      .eq('event_date', eventDate)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      return {
        created: false,
        eventId: existing.id,
        eventDate,
        reason: 'already_exists',
      };
    }

    // The template is canonical so a one-off edit never leaks into later dates.
    const { data: template, error: templateError } = await admin
      .from('events')
      .select('*')
      .eq('id', series.template_event_id)
      .single();
    if (templateError || !template) {
      throw templateError || new Error(`Template missing for series ${series.id}`);
    }

    const payload = buildNextOccurrenceEvent(template, {
      eventDate,
      seriesId: series.id,
      recurrencePosition: (previousEvent.recurrence_position || 0) + 1,
      shareToken: createShareToken(),
    });
    const { data: created, error: createError } = await admin
      .from('events')
      .insert(payload)
      .select('*')
      .single();
    if (createError) {
      // The date-level uniqueness constraint is the final guard for concurrent
      // publish hooks and cron invocations after the initial existence check.
      if (createError.code === '23505') {
        return { created: false, eventDate, reason: 'already_exists' };
      }
      throw createError;
    }

    try {
      await cloneOccurrenceProducts(admin, template.id, created.id);
      const { error: logError } = await admin.from('series_generation_log').insert({
        series_id: series.id,
        event_id: created.id,
        template_event_id: template.id,
        previous_event_id: previousEvent.id,
        generated_for: eventDate,
      });
      if (logError) throw logError;
    } catch (error) {
      await admin.from('events').delete().eq('id', created.id);
      throw error;
    }

    return { created: true, eventId: created.id, eventDate };
  };
}

export const ensureNextOccurrenceDraft = makeEnsureNextOccurrenceDraft();
