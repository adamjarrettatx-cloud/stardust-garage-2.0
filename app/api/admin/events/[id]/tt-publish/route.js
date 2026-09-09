import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { setEventSeriesStatus, getEventSeries } from '@/lib/tickettailor';
import { extractSeriesPublicUrl } from '@/lib/tt-event-create';
import { notifyMany } from '@/lib/notifications/send';
import { resolveAudience, audienceForEvent } from '@/lib/notifications/audience';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f-]{36}$/i;
const HOUR_MS = 60 * 60 * 1000;
const REPLAY_WINDOW_MS = 10 * 60 * 1000;

async function updatePublishAudit(supabase, auditId, fields) {
  const { error } = await supabase
    .from('notification_broadcasts')
    .update(fields)
    .eq('id', auditId);
  if (error) console.error('[tt-publish.audit]', error);
}

// POST /api/admin/events/:id/tt-publish[?force=1]
// Publishes the linked TicketTailor series first, then the website event. Every
// attempt gets a durable audit row; force=1 is the explicit override for a
// deliberate repeat publish inside the ten-minute replay window.
export async function POST(request, { params }) {
  try {
    const { user, unauthorized, reason } = await requireAdminMfa();
    if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });

    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: 'Bad event id' }, { status: 400 });

    const supabase = createAdminClient();
    const { data: audit, error: auditError } = await supabase
      .from('notification_broadcasts')
      .insert({
        idempotency_key: randomUUID(),
        admin_user_id: user.id,
        audience: `ticket_holders_event:${id}`,
        subject: 'Event publish attempt',
        body: 'Publish attempt started.',
        sent_count: 0,
      })
      .select('id')
      .single();
    if (auditError || !audit) {
      console.error('[tt-publish.audit-create]', auditError);
      return NextResponse.json({ error: 'Could not record publish attempt' }, { status: 500 });
    }

    const perEvent = rateLimit({ key: `tt_publish:event:${id}`, limit: 3, windowMs: HOUR_MS });
    const perAdmin = rateLimit({ key: `tt_publish:admin:${user.id}`, limit: 10, windowMs: HOUR_MS });
    if (!perEvent.ok || !perAdmin.ok) {
      await updatePublishAudit(supabase, audit.id, {
        subject: 'Event publish blocked',
        body: 'Blocked by the publish rate limit.',
        sent_count: 0,
      });
      return NextResponse.json(
        { error: 'Too many publish attempts' },
        { status: 429, headers: { 'Retry-After': String(Math.max(perEvent.retryAfterSeconds, perAdmin.retryAfterSeconds)) } },
      );
    }

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, title, status, tt_event_series_id, ticket_url, tt_last_published_at')
      .eq('id', id)
      .single();
    if (eventError || !event) {
      await updatePublishAudit(supabase, audit.id, { subject: 'Event publish blocked', body: 'Event not found.', sent_count: 0 });
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const force = new URL(request.url).searchParams.get('force') === '1';
    const lastPublishedAt = event.tt_last_published_at ? new Date(event.tt_last_published_at).getTime() : NaN;
    if (!force && Number.isFinite(lastPublishedAt) && Date.now() - lastPublishedAt < REPLAY_WINDOW_MS) {
      await updatePublishAudit(supabase, audit.id, {
        subject: 'Event publish blocked',
        body: 'Blocked because this event was published within the last 10 minutes. Re-submit with force=1 to intentionally republish.',
        sent_count: 0,
      });
      return NextResponse.json(
        { error: 'Event was published recently. Use force=1 to intentionally republish.' },
        { status: 409 },
      );
    }

    let ttPublished = false;
    let ttNote = null;
    let resolvedTicketUrl = event.ticket_url || null;

    if (event.tt_event_series_id) {
      if (!process.env.TICKETTAILOR_API_KEY) {
        ttNote = 'TICKETTAILOR_API_KEY is not configured; the website event was published but the TicketTailor series status was not changed.';
      } else {
        let series;
        try {
          series = await setEventSeriesStatus(event.tt_event_series_id, 'published');
          ttPublished = true;
        } catch (err) {
          await updatePublishAudit(supabase, audit.id, {
            subject: 'Event publish failed',
            body: `TicketTailor publish failed: ${err?.message || 'unknown'}`,
            sent_count: 0,
          });
          return NextResponse.json(
            {
              error: `Failed to publish the TicketTailor event series: ${err?.message || 'unknown'}. The website event was left as a draft.`,
              tt_event_series_id: event.tt_event_series_id,
            },
            { status: 502 },
          );
        }

        if (!resolvedTicketUrl) {
          let url = extractSeriesPublicUrl(series);
          if (!url) {
            try {
              url = extractSeriesPublicUrl(await getEventSeries(event.tt_event_series_id));
            } catch (err) {
              console.warn(`tt-publish: could not re-read series ${event.tt_event_series_id} for its URL: ${err?.message || err}`);
            }
          }
          if (url) resolvedTicketUrl = url;
          else {
            ttNote = 'Published, but TicketTailor did not return a public ticket URL — set the ticket link manually on the event if needed.';
            console.warn(`tt-publish: TicketTailor series ${event.tt_event_series_id} returned no public URL; ticket_url left unset.`);
          }
        }
      }
    } else {
      ttNote = 'This event has no linked TicketTailor series; published the website event only.';
    }

    const updateFields = { status: 'published', tt_last_published_at: new Date().toISOString() };
    if (resolvedTicketUrl && resolvedTicketUrl !== event.ticket_url) updateFields.ticket_url = resolvedTicketUrl;

    const { data: updated, error: updateError } = await supabase
      .from('events')
      .update(updateFields)
      .eq('id', id)
      .select()
      .single();
    if (updateError) {
      await updatePublishAudit(supabase, audit.id, {
        subject: 'Event publish failed', body: `Website publish failed: ${updateError.message}`, sent_count: 0,
      });
      return NextResponse.json({ error: `Failed to publish the website event: ${updateError.message}` }, { status: 500 });
    }

    let sentCount = 0;
    try {
      if (updated.visibility !== 'unlisted') {
        const audience = await audienceForEvent(supabase, { event: updated });
        const userIds = await resolveAudience(supabase, audience);
        if (userIds.length > 0) {
          const eventUrl = `/events/${updated.slug || updated.id}`;
          const dateLabel = updated.event_date
            ? new Date(`${updated.event_date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
            : null;
          const results = await notifyMany(supabase, userIds, {
            type: 'event_published',
            title: updated.title || 'New event at Stardust Garage',
            body: dateLabel ? `${dateLabel} · Tap to view` : 'Tap to view',
            data: { event_id: updated.id, url: eventUrl, audience },
          });
          sentCount = results.filter((result) => result.ok).length;
          console.log('[tt-publish] notified', { eventId: updated.id, audience, recipients: userIds.length });
        }
      }
    } catch (notifyErr) {
      console.error('[tt-publish] notification fanout failed (non-fatal):', notifyErr?.message || notifyErr);
    }

    await updatePublishAudit(supabase, audit.id, {
      subject: 'Event publish completed',
      body: `Website event published${ttPublished ? ' and TicketTailor series published' : ''}.`,
      sent_count: sentCount,
    });

    return NextResponse.json({
      success: true,
      eventId: id,
      status: updated.status,
      tt_event_series_id: event.tt_event_series_id,
      ticket_url: updated.ticket_url || null,
      ttPublished,
      ttNote,
    });
  } catch (err) {
    console.error('events/[id]/tt-publish route error:', err);
    return NextResponse.json({ error: `Server error: ${err?.message || 'unknown'}` }, { status: 500 });
  }
}
