import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEventSeries } from '@/lib/tickettailor';
import { parseSeriesIdInput, isUnlink } from '@/lib/tt-link-utils';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f-]{36}$/i;

// POST /api/admin/events/:id/tt-link
// Body: { tt_event_series_id: string | null, verify?: boolean }
//
// Links (or, with null, unlinks) a local event to a TicketTailor event series.
// Admin only, gated by requireAdminMfa() — admin status is derived server-side
// from team_members, NOT from anything the client sends. The TICKETTAILOR_API_KEY
// is never exposed to the client; the optional existence check happens here,
// server-side, and only ever GETs (getEventSeries) — no TicketTailor writes.
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

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Bad request body' }, { status: 400 });
    }

    const parsed = parseSeriesIdInput(body?.tt_event_series_id);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const seriesId = parsed.value; // canonical string or null
    const unlink = isUnlink(seriesId);

    const supabase = createAdminClient();

    // Confirm the event exists before touching it, so a bad id 404s cleanly
    // rather than silently updating zero rows.
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, title, tt_event_series_id')
      .eq('id', id)
      .single();
    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Optional, opt-in existence check against TicketTailor. Read-only. Skipped
    // on unlink. If the API key is missing we degrade gracefully (skip the
    // check + flag it) rather than failing the link — the column can still be
    // set so analytics/discounts can use it once the key is configured.
    let verified = null;
    let verifyNote = null;
    if (!unlink && body?.verify) {
      if (!process.env.TICKETTAILOR_API_KEY) {
        verified = false;
        verifyNote = 'TICKETTAILOR_API_KEY is not configured; saved without verifying.';
      } else {
        try {
          const series = await getEventSeries(seriesId);
          if (!series || !series.id) {
            return NextResponse.json(
              { error: `TicketTailor has no event series "${seriesId}".` },
              { status: 422 },
            );
          }
          verified = true;
          verifyNote = `Verified: ${series.name || series.id}`;
        } catch (err) {
          // A 404 from TT means the series id is wrong — reject it. Any other
          // failure (network, auth) shouldn't block the save; flag and proceed.
          const msg = String(err?.message || err);
          if (/\(404\)/.test(msg)) {
            return NextResponse.json(
              { error: `TicketTailor has no event series "${seriesId}".` },
              { status: 422 },
            );
          }
          verified = false;
          verifyNote = 'Could not reach TicketTailor to verify; saved anyway.';
        }
      }
    }

    const { error: updateError } = await supabase
      .from('events')
      .update({ tt_event_series_id: seriesId })
      .eq('id', id);
    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to update event: ' + updateError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      eventId: id,
      tt_event_series_id: seriesId,
      linked: !unlink,
      verified,
      verifyNote,
      // The metrics cache is only repopulated by the refresh route/cron, so a
      // freshly (un)linked event won't show revenue until a refresh runs.
      refreshNeeded: true,
    });
  } catch (err) {
    console.error('events/[id]/tt-link route error:', err);
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || 'unknown') },
      { status: 500 },
    );
  }
}
