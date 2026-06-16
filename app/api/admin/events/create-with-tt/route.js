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
  shouldPublishLocalEvent,
} from '@/lib/tt-event-create';

export const runtime = 'nodejs';

// POST /api/admin/events/create-with-tt
// Body: {
//   title, slug, event_date, event_time, event_end_time, description?, image_url?,
//   category?, member_discount_percent?,
//   ticket_types: [{ name, price, quantity?, description? }]
// }
//
// Creates and PUBLISHES an event on both sides in one flow. The ordering is
// chosen so that NEITHER side can be left in a bad state by a failure in the
// other:
//   1) pre-check the slug, then insert the local website event as a hidden
//      DRAFT (status='draft'). Doing the local insert first means the most
//      likely failure (a duplicate slug) aborts BEFORE anything is created on
//      TicketTailor — we never publish a live, selling TicketTailor series and
//      then discover we can't save the website event.
//   2) create the TicketTailor event series (series-level metadata only),
//   3) create the occurrence that carries the event date/start/end time,
//   4) create each ticket type on the series,
//   5) publish the TicketTailor series,
//   6) resolve the public ticket URL, then flip the local event to PUBLISHED.
//
// Two safety invariants drive this:
//   * The local event is never PUBLISHED (publicly visible) until TicketTailor
//     has published AND returned a usable ticket_url — so the site never shows a
//     live event with no working "Buy tickets" link (it would render as a
//     "PRIVATE EVENT"). If the URL can't be resolved, the event stays a draft
//     and the admin is told to finish from the editor.
//   * If a TicketTailor step fails, the local event simply stays a draft
//     (hidden). Publish is the LAST TicketTailor step, so a failure anywhere
//     before it means nothing is selling yet — there is no orphaned live series.
//
// Admin only, gated by requireAdminMfa(). The TICKETTAILOR_API_KEY is never
// exposed to the client; all TicketTailor calls happen here, server-side. If the
// key is not configured we publish the local event directly (the admin isn't
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

    // 0) Pre-check the slug. The events.slug is the public URL key and the
    // single most likely insert failure. Catching it here means we never touch
    // TicketTailor for a request that can't be saved locally.
    const { data: slugRow, error: slugError } = await supabase
      .from('events')
      .select('id')
      .eq('slug', v.slug)
      .maybeSingle();
    if (slugError) {
      return NextResponse.json(
        { error: 'Could not verify the URL slug: ' + slugError.message },
        { status: 500 },
      );
    }
    if (slugRow) {
      return NextResponse.json(
        { error: `The URL slug "${v.slug}" is already in use. Choose a different slug.` },
        { status: 409 },
      );
    }

    // 1) Insert the local website event as a hidden DRAFT first. Nothing on
    // TicketTailor exists yet, so if this fails (e.g. a slug race that slipped
    // past the pre-check) we abort with nothing to clean up.
    const { data: draftEvent, error: insertError } = await supabase
      .from('events')
      .insert({
        title: v.title,
        slug: v.slug,
        event_date: v.eventDate,
        event_time: v.eventTime,
        event_end_time: v.eventEndTime,
        description: v.description,
        image_url: v.imageUrl,
        category: v.category,
        member_discount_percent: v.memberDiscountPercent,
        status: 'draft',
      })
      .select()
      .single();
    if (insertError) {
      // 23505 = unique_violation (slug taken between the pre-check and insert).
      const taken = insertError.code === '23505' || /duplicate|unique/i.test(insertError.message || '');
      return NextResponse.json(
        {
          error: taken
            ? `The URL slug "${v.slug}" is already in use. Choose a different slug.`
            : 'Failed to save the website event: ' + insertError.message,
        },
        { status: taken ? 409 : 500 },
      );
    }

    const eventId = draftEvent.id;

    // If TicketTailor isn't configured, there is no series to wait on. Publish
    // the local event directly so the admin isn't blocked, and say so. (This is
    // the only path that publishes without a ticket_url, and only because there
    // is deliberately no ticketing in this environment.)
    if (!ttConfigured) {
      const { data: published, error: pubError } = await supabase
        .from('events')
        .update({ status: 'published' })
        .eq('id', eventId)
        .select()
        .single();
      if (pubError) {
        return NextResponse.json(
          {
            error: 'Saved the event as a draft but failed to publish it: ' + pubError.message,
            eventId,
            status: 'draft',
          },
          { status: 500 },
        );
      }
      return NextResponse.json({
        success: true,
        event: published,
        eventId,
        tt_event_series_id: null,
        ticket_url: null,
        ticketTypesCreated: 0,
        ttConfigured: false,
        ttPublished: false,
        ttNote:
          'TICKETTAILOR_API_KEY is not configured in this environment, so no TicketTailor event series was created. The website event was published; link and publish a series later from the event editor.',
        status: 'published',
      });
    }

    // Helper: a TicketTailor step failed AFTER the local draft was created but
    // BEFORE the series was published. The draft is hidden, so nothing is live;
    // we just report it and leave the draft for the admin to retry/delete.
    const ttPrePublishFailure = (message, seriesId, status = 502) =>
      NextResponse.json(
        {
          error: message,
          eventId,
          tt_event_series_id: seriesId,
          status: 'draft',
        },
        { status },
      );

    // 2) Create the event series (series-level metadata only — no date/time).
    let series;
    try {
      series = await createEventSeries(
        buildEventSeriesBody({ title: v.title, description: v.description }),
      );
    } catch (err) {
      return ttPrePublishFailure(
        'Failed to create the TicketTailor event series: ' +
          (err?.message || 'unknown') +
          '. The website event was saved as a hidden draft; retry publishing it from the event editor.',
        null,
      );
    }

    const ttEventSeriesId = series?.id || null;
    if (!ttEventSeriesId) {
      return ttPrePublishFailure(
        'TicketTailor did not return an event series id. The website event was saved as a hidden draft.',
        null,
      );
    }

    // 3) Create the occurrence that carries the event date and start/end time.
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
      return ttPrePublishFailure(
        `Created the TicketTailor series (${ttEventSeriesId}) but failed to add its date/time: ${
          err?.message || 'unknown'
        }. The website event is a hidden draft; delete the empty draft series in TicketTailor and retry.`,
        ttEventSeriesId,
      );
    }

    // 4) Create each ticket type on the new series.
    let ticketTypesCreated = 0;
    for (const tt of v.ticketTypes) {
      try {
        await createTicketType(ttEventSeriesId, buildTicketTypeBody(tt));
        ticketTypesCreated++;
      } catch (err) {
        return ttPrePublishFailure(
          `Created the TicketTailor series (${ttEventSeriesId}) but failed on ticket type "${tt.name}": ${
            err?.message || 'unknown'
          }. The website event is a hidden draft; fix the ticket type in TicketTailor (or delete the draft series) and retry.`,
          ttEventSeriesId,
        );
      }
    }

    // 5) Publish the series. This is the last TicketTailor write — after it
    // succeeds the box office is live, so from here on a local failure must NOT
    // leave the series orphaned-and-live behind a missing website event. We
    // guard that by only ever flipping the local draft to published below; if
    // that flip fails the event stays a (hidden) draft the admin can publish.
    let publishedSeries;
    try {
      publishedSeries = await setEventSeriesStatus(ttEventSeriesId, 'published');
    } catch (err) {
      return ttPrePublishFailure(
        `Created the TicketTailor series (${ttEventSeriesId}) with its date and ticket types, but publishing it failed: ${
          err?.message || 'unknown'
        }. The website event is a hidden draft; publish the series from the event editor (which retries the TicketTailor publish) once resolved.`,
        ttEventSeriesId,
      );
    }

    // Resolve the public box-office URL. Prefer the publish response; if it
    // carried no URL, re-read the series (read-only). We only ever use a URL
    // TicketTailor actually returned — never a guessed pattern.
    let ttTicketUrl = extractSeriesPublicUrl(publishedSeries);
    if (!ttTicketUrl) {
      try {
        ttTicketUrl = extractSeriesPublicUrl(await getEventSeries(ttEventSeriesId));
      } catch (err) {
        console.warn(
          `create-with-tt: could not re-read series ${ttEventSeriesId} for its URL: ${err?.message || err}`,
        );
      }
    }

    // SAFETY: a published event with no ticket_url renders publicly as a
    // "PRIVATE EVENT" with no buy link. For this ticketed-create flow that is a
    // failure, not an acceptable state — the whole point is a sellable event. So
    // if we can't resolve a URL we leave the event as a hidden DRAFT and tell the
    // admin exactly what to do, rather than publishing an unbuyable event.
    const decision = shouldPublishLocalEvent({
      ttConfigured: true,
      ttPublished: true,
      ticketUrl: ttTicketUrl,
    });
    if (!decision.publish) {
      console.warn(
        `create-with-tt: TicketTailor series ${ttEventSeriesId} published but returned no public URL; leaving event ${eventId} as draft.`,
      );
      return NextResponse.json(
        {
          success: false,
          eventId,
          tt_event_series_id: ttEventSeriesId,
          ticketTypesCreated,
          ttConfigured: true,
          ttPublished: true,
          status: 'draft',
          error:
            'The TicketTailor series was published, but it did not return a public ticket URL. The website event was kept as a hidden draft to avoid showing a live event with no buy link. Add the ticket link on the event in the editor, then publish it.',
        },
        { status: 502 },
      );
    }

    // 6) Everything succeeded and we have a working buy link — flip the local
    // event to PUBLISHED with the resolved ticket URL. If THIS update fails the
    // series is live but the website event stays a hidden draft (not public), so
    // the admin can publish it from the editor; nothing is publicly broken.
    const { data: published, error: publishError } = await supabase
      .from('events')
      .update({ status: 'published', ticket_url: ttTicketUrl, tt_event_series_id: ttEventSeriesId })
      .eq('id', eventId)
      .select()
      .single();
    if (publishError) {
      return NextResponse.json(
        {
          success: false,
          error:
            'The TicketTailor series was published, but saving the published website event failed: ' +
            publishError.message +
            '. The event is a hidden draft linked to the live series; publish it from the event editor.',
          eventId,
          tt_event_series_id: ttEventSeriesId,
          ticket_url: ttTicketUrl,
          status: 'draft',
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      event: published,
      eventId,
      tt_event_series_id: ttEventSeriesId,
      ticket_url: ttTicketUrl,
      ticketTypesCreated,
      ttConfigured: true,
      ttPublished: true,
      ttNote: null,
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
