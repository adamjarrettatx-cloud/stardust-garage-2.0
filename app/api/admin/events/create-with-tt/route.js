import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { createEventSeries, createTicketType } from '@/lib/tickettailor';
import {
  validateCreatePayload,
  buildEventSeriesBody,
  buildTicketTypeBody,
} from '@/lib/tt-event-create';

export const runtime = 'nodejs';

// POST /api/admin/events/create-with-tt
// Body: {
//   title, slug, event_date, event_time?, description?, image_url?,
//   category?, member_discount_percent?,
//   ticket_types: [{ name, price, quantity?, description? }]
// }
//
// Creates BOTH a local website event (status='draft') and a TicketTailor
// event series (status=draft) with the requested ticket types, then links the
// local event to the returned series id. Admin only, gated by requireAdminMfa()
// — admin status is derived server-side from team_members. The
// TICKETTAILOR_API_KEY is never exposed to the client; all TicketTailor calls
// happen here, server-side.
//
// Ordering is deliberate: create the TicketTailor series FIRST so we never
// store a local event pointing at a series that failed to create. If the API
// key is not configured we still create the local draft (so the admin isn't
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
    let ttNote = null;
    let ticketTypesCreated = 0;

    if (ttConfigured) {
      // 1) Create the draft event series.
      let series;
      try {
        series = await createEventSeries(
          buildEventSeriesBody({
            title: v.title,
            eventDate: v.eventDate,
            eventTime: v.eventTime,
            description: v.description,
          }),
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

      // 2) Create each ticket type on the new series. A failure here leaves a
      // draft series behind in TicketTailor, but since both sides are drafts
      // that is recoverable by the admin; we surface a clear error and stop
      // rather than create a half-configured local event.
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
    } else {
      ttNote =
        'TICKETTAILOR_API_KEY is not configured in this environment, so no TicketTailor event series was created. The website event was saved as a draft; link a series later from the event editor.';
    }

    // 3) Insert the local website event as a DRAFT, linked to the TT series.
    const insertRow = {
      title: v.title,
      slug: v.slug,
      event_date: v.eventDate,
      event_time: v.eventTime,
      description: v.description,
      image_url: v.imageUrl,
      category: v.category,
      member_discount_percent: v.memberDiscountPercent,
      tt_event_series_id: ttEventSeriesId,
      status: 'draft',
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
          // Report the orphaned draft series so the admin can recover it.
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
      ticketTypesCreated,
      ttConfigured,
      ttNote,
      // Both sides are drafts; the publish action takes them live together.
      status: 'draft',
    });
  } catch (err) {
    console.error('events/create-with-tt route error:', err);
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || 'unknown') },
      { status: 500 },
    );
  }
}
