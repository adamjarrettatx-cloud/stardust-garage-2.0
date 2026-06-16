import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { setEventSeriesStatus } from '@/lib/tickettailor';

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
      .select('id, title, status, tt_event_series_id')
      .eq('id', id)
      .single();
    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    let ttPublished = false;
    let ttNote = null;

    if (event.tt_event_series_id) {
      if (!process.env.TICKETTAILOR_API_KEY) {
        ttNote =
          'TICKETTAILOR_API_KEY is not configured; the website event was published but the TicketTailor series status was not changed.';
      } else {
        try {
          await setEventSeriesStatus(event.tt_event_series_id, 'published');
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
      }
    } else {
      ttNote = 'This event has no linked TicketTailor series; published the website event only.';
    }

    const { data: updated, error: updateError } = await supabase
      .from('events')
      .update({ status: 'published' })
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
