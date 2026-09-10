import { randomUUID } from 'node:crypto';
import { setEventSeriesStatus, getEventSeries } from './tickettailor.js';
import { extractSeriesPublicUrl } from './tt-event-create.js';
import { notifyMany } from './notifications/send.js';
import { resolveAudience, audienceForEvent } from './notifications/audience.js';
import { rateLimit } from './rate-limit.js';
import { ensureNextOccurrenceDraft } from './series-generation.js';

const HOUR_MS = 60 * 60 * 1000;
const REPLAY_WINDOW_MS = 10 * 60 * 1000;

async function updatePublishAudit(supabase, auditId, fields) {
  const { error } = await supabase
    .from('notification_broadcasts')
    .update(fields)
    .eq('id', auditId);
  if (error) console.error('[publish-event.audit]', error);
}

export function makePublishEvent({
  setTicketTailorStatus = setEventSeriesStatus,
  getTicketTailorSeries = getEventSeries,
  resolveTicketUrl = extractSeriesPublicUrl,
  notifyRecipients = notifyMany,
  resolveNotificationAudience = resolveAudience,
  audienceForPublishedEvent = audienceForEvent,
  checkRateLimit = rateLimit,
  ensureNextDraft = ensureNextOccurrenceDraft,
  now = () => new Date(),
} = {}) {
  return async function publishEvent(supabase, eventId, { via, force = false, actorUserId = null }) {
    const isCron = via === 'cron';
    const { data: audit, error: auditError } = await supabase
      .from('notification_broadcasts')
      .insert({
        idempotency_key: randomUUID(),
        admin_user_id: isCron ? null : actorUserId,
        audience: `ticket_holders_event:${eventId}`,
        subject: isCron ? 'Event publish attempt (cron auto-publish)' : 'Event publish attempt',
        body: isCron ? 'Cron auto-publish attempt started.' : 'Publish attempt started.',
        sent_count: 0,
      })
      .select('id')
      .single();
    if (auditError || !audit) {
      console.error('[publish-event.audit-create]', auditError);
      return { status: 500, body: { error: 'Could not record publish attempt' } };
    }

    if (!isCron) {
      const perEvent = checkRateLimit({ key: `tt_publish:event:${eventId}`, limit: 3, windowMs: HOUR_MS });
      const perAdmin = checkRateLimit({ key: `tt_publish:admin:${actorUserId}`, limit: 10, windowMs: HOUR_MS });
      if (!perEvent.ok || !perAdmin.ok) {
        await updatePublishAudit(supabase, audit.id, {
          subject: 'Event publish blocked',
          body: 'Blocked by the publish rate limit.',
          sent_count: 0,
        });
        return {
          status: 429,
          body: { error: 'Too many publish attempts' },
          headers: { 'Retry-After': String(Math.max(perEvent.retryAfterSeconds, perAdmin.retryAfterSeconds)) },
        };
      }
    }

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, title, status, series_id, tt_event_series_id, ticket_url, tt_last_published_at')
      .eq('id', eventId)
      .single();
    if (eventError || !event) {
      await updatePublishAudit(supabase, audit.id, {
        subject: 'Event publish blocked',
        body: 'Event not found.',
        sent_count: 0,
      });
      return { status: 404, body: { error: 'Event not found' } };
    }

    const lastPublishedAt = event.tt_last_published_at ? new Date(event.tt_last_published_at).getTime() : NaN;
    if (!isCron && !force && Number.isFinite(lastPublishedAt) && now().getTime() - lastPublishedAt < REPLAY_WINDOW_MS) {
      await updatePublishAudit(supabase, audit.id, {
        subject: 'Event publish blocked',
        body: 'Blocked because this event was published within the last 10 minutes. Re-submit with force=1 to intentionally republish.',
        sent_count: 0,
      });
      return {
        status: 409,
        body: { error: 'Event was published recently. Use force=1 to intentionally republish.' },
      };
    }

    let ttPublished = false;
    let ttNote = null;
    let resolvedTicketUrl = event.ticket_url || null;
    if (event.tt_event_series_id && isCron) {
      // Generated occurrences must not control legacy TicketTailor inventory.
      ttNote = 'Skipped TicketTailor publish during cron auto-publish.';
      console.warn('[publish-event] skipped TicketTailor during cron auto-publish', { eventId, ttEventSeriesId: event.tt_event_series_id });
    } else if (event.tt_event_series_id) {
      if (!process.env.TICKETTAILOR_API_KEY) {
        ttNote = 'TICKETTAILOR_API_KEY is not configured; the website event was published but the TicketTailor series status was not changed.';
      } else {
        let series;
        try {
          series = await setTicketTailorStatus(event.tt_event_series_id, 'published');
          ttPublished = true;
        } catch (error) {
          await updatePublishAudit(supabase, audit.id, {
            subject: 'Event publish failed',
            body: `TicketTailor publish failed: ${error?.message || 'unknown'}`,
            sent_count: 0,
          });
          return {
            status: 502,
            body: {
              error: `Failed to publish the TicketTailor event series: ${error?.message || 'unknown'}. The website event was left as a draft.`,
              tt_event_series_id: event.tt_event_series_id,
            },
          };
        }

        if (!resolvedTicketUrl) {
          let url = resolveTicketUrl(series);
          if (!url) {
            try {
              url = resolveTicketUrl(await getTicketTailorSeries(event.tt_event_series_id));
            } catch (error) {
              console.warn(`[publish-event] could not re-read TicketTailor series ${event.tt_event_series_id}: ${error?.message || error}`);
            }
          }
          if (url) resolvedTicketUrl = url;
          else {
            ttNote = 'Published, but TicketTailor did not return a public ticket URL — set the ticket link manually on the event if needed.';
            console.warn(`[publish-event] TicketTailor series ${event.tt_event_series_id} returned no public URL; ticket_url left unset.`);
          }
        }
      }
    } else {
      ttNote = 'This event has no linked TicketTailor series; published the website event only.';
    }

    const updateFields = { status: 'published', tt_last_published_at: now().toISOString() };
    if (resolvedTicketUrl && resolvedTicketUrl !== event.ticket_url) updateFields.ticket_url = resolvedTicketUrl;
    const { data: updated, error: updateError } = await supabase
      .from('events')
      .update(updateFields)
      .eq('id', eventId)
      .select()
      .single();
    if (updateError) {
      await updatePublishAudit(supabase, audit.id, {
        subject: 'Event publish failed',
        body: `Website publish failed: ${updateError.message}`,
        sent_count: 0,
      });
      return { status: 500, body: { error: `Failed to publish the website event: ${updateError.message}` } };
    }

    let sentCount = 0;
    try {
      if (updated.visibility !== 'unlisted') {
        const audience = await audienceForPublishedEvent(supabase, { event: updated });
        const userIds = await resolveNotificationAudience(supabase, audience);
        if (userIds.length > 0) {
          const eventUrl = `/events/${updated.slug || updated.id}`;
          const dateLabel = updated.event_date
            ? new Date(`${updated.event_date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
            : null;
          const results = await notifyRecipients(supabase, userIds, {
            type: 'event_published',
            title: updated.title || 'New event at Stardust Garage',
            body: dateLabel ? `${dateLabel} · Tap to view` : 'Tap to view',
            data: { event_id: updated.id, url: eventUrl, audience },
          });
          sentCount = results.filter((result) => result.ok).length;
          console.log('[publish-event] notified', { eventId: updated.id, audience, recipients: userIds.length });
        }
      }
    } catch (error) {
      console.error('[publish-event] notification fanout failed (non-fatal):', error?.message || error);
    }

    if (updated.series_id) {
      try {
        const { data: series, error: seriesError } = await supabase
          .from('event_series')
          .select('*')
          .eq('id', updated.series_id)
          .maybeSingle();
        if (seriesError) throw seriesError;
        const generation = await ensureNextDraft(supabase, series, { previousEvent: updated });
        console.log('[publish-event] ensured next series draft', {
          seriesId: updated.series_id,
          createdEventId: generation.eventId || null,
          reason: generation.reason || null,
        });
      } catch (error) {
        console.error('[publish-event] next series draft generation failed (non-fatal):', {
          seriesId: updated.series_id,
          error: error?.message || error,
        });
      }
    }

    await updatePublishAudit(supabase, audit.id, {
      subject: isCron ? 'Event publish completed (cron auto-publish)' : 'Event publish completed',
      body: `Website event published${ttPublished ? ' and TicketTailor series published' : ''}.`,
      sent_count: sentCount,
    });

    return {
      status: 200,
      body: {
        success: true,
        eventId,
        status: updated.status,
        tt_event_series_id: event.tt_event_series_id,
        ticket_url: updated.ticket_url || null,
        ttPublished,
        ttNote,
      },
    };
  };
}

export const publishEvent = makePublishEvent();
