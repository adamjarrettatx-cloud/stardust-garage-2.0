import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  createEventSeries,
  createEventOccurrence,
  createTicketType,
  setEventSeriesStatus,
  getEventSeries,
} from '@/lib/tickettailor';
import {
  validateCreatePayload,
  buildEventSeriesBody,
  buildOccurrenceBody,
  buildTicketTypeBody,
  extractSeriesPublicUrl,
} from '@/lib/tt-event-create';

export const runtime = 'nodejs';

// POST /api/admin/events/create-with-tt
// Body: {
//   title, slug, event_date, event_time, event_end_time, description?, image_url?,
//   category?, member_discount_percent?,
//   ticket_types: [{ name, price, quantity?, description? }]
// }
//
// Creates and PUBLISHES an event on both sides in one flow:
//   1) create the TicketTailor event series (series-level metadata only),
//   2) create the occurrence that carries the event date/start/end time,
//   3) create each ticket type on the series,
//   4) publish the TicketTailor series,
//   5) insert the local website event as status='published', linked to the
//      series id with the resolved public ticket URL.
// Admin only, gated by requireAdminMfa() — admin status is derived server-side
// from team_members. The TICKETTAILOR_API_KEY is never exposed to the client;
// all TicketTailor calls happen here, server-side.
//
// Ordering is deliberate: every TicketTailor step (including PUBLISH) runs and
// must succeed BEFORE the local event is inserted as published, so the website
// never advertises an event whose tickets aren't actually on sale. If the API
// key is not configured we still publish the local event (so the admin isn't
// blocked) and report that the TicketTailor side was skipped.
export async function POST(request) {
  try {
    const { unauthorized, reason } = await requireAdminMfa();
    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Bad request body' }, { status: 400 });
    }

    const parsed = validateCreatePayload(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const v = parsed.value;

    const supabase = createAdminClient();
    const ttConfigured = Boolean(process.env.TICKETTAILOR_API_KEY);

    let ttEventSeriesId = null;
    let ttTicketUrl = null;
    let ttNote = null;
    let ttPublished = false;
    let ticketTypesCreated = 0;

    if (ttConfigured) {
      // 1) Create the event series (series-level metadata only — no date/time).
      let series;
      try {
        series = await createEventSeries(
          buildEventSeriesBody({ title: v.title, description: v.description }),
        );
      } catch (err) {
        return NextResponse.json(
          { error: 'Failed to create TicketTailor event series: ' + (err?.message || 'unknown') },
          { status: 502 },
        );
      }

      ttEventSeriesId = series?.id || null;
      if (!ttEventSeriesId) {
        return NextResponse.json(
          { error: 'TicketTailor did not return an event series id.' },
          { status: 502 },
        );
      }

      // 2) Create the occurrence that carries the event date and start/end time.
      // This is the step that actually puts the website's date/time onto
      // TicketTailor; the series itself holds no date.
      try {
        await createEventOccurrence(
          ttEventSeriesId,
          buildOccurrenceBody({
            eventDate: v.eventDate,
            eventTime: v.eventTime,
            eventEndTime: v.eventEndTime,
          }),
        );
      } catch (err) {
        return NextResponse.json(
          {
            error: `Created the TicketTailor series (${ttEventSeriesId}) but failed to add its date/time: ${
              err?.message || 'unknown'
            }. Delete the empty draft series in TicketTailor and retry.`,
            tt_event_series_id: ttEventSeriesId,
          },
          { status: 502 },
        );
      }

      // 3) Create each ticket type on the new series.
      for (const tt of v.ticketTypes) {
        try {
          await createTicketType(ttEventSeriesId, buildTicketTypeBody(tt));
          ticketTypesCreated++;
        } catch (err) {
          return NextResponse.json(
            {
              error: `Created the TicketTailor series (${ttEventSeriesId}) but failed on ticket type "${tt.name}": ${
                err?.message || 'unknown'
              }. The draft series exists in TicketTailor; fix the ticket type there or delete the draft and retry.`,
              tt_event_series_id: ttEventSeriesId,
            },
            { status: 502 },
          );
        }
      }

      // 4) Publish the series. Must succeed before we publish the local event,
      // so the website never links to an unpublished (unsellable) box office.
      let publishedSeries;
      try {
        publishedSeries = await setEventSeriesStatus(ttEventSeriesId, 'published');
        ttPublished = true;
      } catch (err) {
        return NextResponse.json(
          {
            error: `Created the TicketTailor series (${ttEventSeriesId}) with its date and ticket types, but publishing it failed: ${
              err?.message || 'unknown'
            }. The draft exists in TicketTailor; publish it there or delete and retry. The website event was NOT created.`,
            tt_event_series_id: ttEventSeriesId,
          },
          { status: 502 },
        );
      }

      // Resolve the public box-office URL so the published event page shows a
      // working "Buy tickets" link. Prefer the publish response; if it carried
      // no URL, re-read the series (read-only). We only ever use a URL
      // TicketTailor actually returned — never a guessed pattern. A missing URL
      // is non-fatal: publish still succeeded, we just record it honestly.
      ttTicketUrl = extractSeriesPublicUrl(publishedSeries);
      if (!ttTicketUrl) {
        try {
          ttTicketUrl = extractSeriesPublicUrl(await getEventSeries(ttEventSeriesId));
        } catch (err) {
          console.warn(
            `create-with-tt: could not re-read series ${ttEventSeriesId} for its URL: ${err?.message || err}`,
          );
        }
      }
      if (!ttTicketUrl) {
        ttNote =
          'Published on TicketTailor, but it did not return a public ticket URL — set the ticket link manually on the event if needed.';
        console.warn(
          `create-with-tt: TicketTailor series ${ttEventSeriesId} returned no public URL; ticket_url left null.`,
        );
      }
    } else {
      ttNote =
        'TICKETTAILOR_API_KEY is not configured in this environment, so no TicketTailor event series was created. The website event was still published; link and publish a series later from the event editor.';
    }

    // 5) Insert the local website event as PUBLISHED, linked to the TT series.
    const insertRow = {
      title: v.title,
      slug: v.slug,
      event_date: v.eventDate,
      event_time: v.eventTime,
      event_end_time: v.eventEndTime,
      description: v.description,
      image_url: v.imageUrl,
      category: v.category,
      member_discount_percent: v.memberDiscountPercent,
      tt_event_series_id: ttEventSeriesId,
      ticket_url: ttTicketUrl,
      status: 'published',
    };

    const { data: saved, error: insertError } = await supabase
      .from('events')
      .insert(insertRow)
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        {
          error: 'Failed to save the website event: ' + insertError.message,
          // Report the (already published) series so the admin can recover it.
          tt_event_series_id: ttEventSeriesId,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      event: saved,
      eventId: saved.id,
      tt_event_series_id: ttEventSeriesId,
      ticket_url: ttTicketUrl,
      ticketTypesCreated,
      ttConfigured,
      ttPublished,
      ttNote,
      // Both sides are live.
      status: 'published',
    });
  } catch (err) {
    console.error('events/create-with-tt route error:', err);
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || 'unknown') },
      { status: 500 },
    );
  }
}
