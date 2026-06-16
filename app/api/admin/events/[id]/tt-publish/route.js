import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { setEventSeriesStatus, getEventSeries } from '@/lib/tickettailor';
import { extractSeriesPublicUrl } from '@/lib/tt-event-create';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f-]{36}$/i;

// POST /api/admin/events/:id/tt-publish
// Body: (none required)
//
// Publishes a draft event on BOTH sides at once: it sets the linked
// TicketTailor event series to status='published', then flips the local
// website event to status='published' so it appears on the public /events page.
// Admin only, gated by requireAdminMfa().
//
// Ordering is deliberate: publish TicketTailor FIRST. If TT publish fails we do
// NOT flip the local event, so we never advertise a public website event whose
// tickets aren't actually on sale. If the event has no linked series (or the
// API key is missing), we still publish the website event and report that the
// TicketTailor side was skipped — a private/no-ticket event is a valid case.
export async function POST(request, { params }) {
  try {
    const { unauthorized, reason } = await requireAdminMfa();
    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
    }

    const { id } = await params;
    if (!UUID.test(id)) {
      return NextResponse.json({ error: 'Bad event id' }, { status: 400 });
    }

    const supabase = createAdminClient();

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, title, status, tt_event_series_id, ticket_url')
      .eq('id', id)
      .single();
    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    let ttPublished = false;
    let ttNote = null;
    // Backfill ticket_url only when the event doesn't already have one, so we
    // never clobber a URL an admin set by hand on the manual flow.
    let resolvedTicketUrl = event.ticket_url || null;

    if (event.tt_event_series_id) {
      if (!process.env.TICKETTAILOR_API_KEY) {
        ttNote =
          'TICKETTAILOR_API_KEY is not configured; the website event was published but the TicketTailor series status was not changed.';
      } else {
        let series;
        try {
          // Returns the updated series object, which carries the public URL.
          series = await setEventSeriesStatus(event.tt_event_series_id, 'published');
          ttPublished = true;
        } catch (err) {
          // Do not flip the local event if TT publish failed — keep both sides
          // consistent (still a draft) so we don't advertise unsellable tickets.
          return NextResponse.json(
            {
              error:
                'Failed to publish the TicketTailor event series: ' +
                (err?.message || 'unknown') +
                '. The website event was left as a draft.',
              tt_event_series_id: event.tt_event_series_id,
            },
            { status: 502 },
          );
        }

        // Resolve the public box-office URL so the "Buy tickets" link works on
        // the now-public event page. Prefer the status-update response; if it
        // didn't carry a URL, re-read the series (read-only). Only fill it when
        // the event has no ticket_url yet. A missing URL is non-fatal: publish
        // still succeeds, we just log it.
        if (!resolvedTicketUrl) {
          let url = extractSeriesPublicUrl(series);
          if (!url) {
            try {
              url = extractSeriesPublicUrl(await getEventSeries(event.tt_event_series_id));
            } catch (err) {
              console.warn(
                `tt-publish: could not re-read series ${event.tt_event_series_id} for its URL: ${err?.message || err}`,
              );
            }
          }
          if (url) {
            resolvedTicketUrl = url;
          } else {
            ttNote =
              'Published, but TicketTailor did not return a public ticket URL — set the ticket link manually on the event if needed.';
            console.warn(
              `tt-publish: TicketTailor series ${event.tt_event_series_id} returned no public URL; ticket_url left unset.`,
            );
          }
        }
      }
    } else {
      ttNote = 'This event has no linked TicketTailor series; published the website event only.';
    }

    const updateFields = { status: 'published' };
    if (resolvedTicketUrl && resolvedTicketUrl !== event.ticket_url) {
      updateFields.ticket_url = resolvedTicketUrl;
    }

    const { data: updated, error: updateError } = await supabase
      .from('events')
      .update(updateFields)
      .eq('id', id)
      .select()
      .single();
    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to publish the website event: ' + updateError.message },
        { status: 500 },
      );
    }

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
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || 'unknown') },
      { status: 500 },
    );
  }
}
