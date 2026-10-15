import { NextResponse } from 'next/server';
import { createRequestScopedClient, requirePartner } from '@/lib/auth-helpers';
import { profileCapabilities } from '@/lib/profile-capabilities';
import { attendanceLabel, longDateLabel, parsePitchInput, pitchErrorResponse, timeRangeLabel } from '@/lib/date-pitches';
import { sendInternalNotification } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function gate(partner) {
  return profileCapabilities(partner?.contact_type).pitches;
}

// GET /api/portal/pitches — the Programmer's own pitches, newest first.
export async function GET(request) {
  const { partner, unauthorized } = await requirePartner(request);
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!gate(partner)) return NextResponse.json({ error: 'Date pitches are not available for this profile.' }, { status: 403 });
  const supabase = await createRequestScopedClient(request);
  const { data, error } = await supabase.rpc('partner_my_pitches');
  if (error) {
    const r = pitchErrorResponse(error);
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
  return NextResponse.json({ pitches: data || [] }, { headers: { 'Cache-Control': 'private, no-store' } });
}

// POST /api/portal/pitches — pitch an event for an open date. The database
// re-checks that the date is open and within the next 12 months. A pitch never
// holds the date.
export async function POST(request) {
  const { partner, unauthorized } = await requirePartner(request);
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!gate(partner)) return NextResponse.json({ error: 'Date pitches are not available for this profile.' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = parsePitchInput(body);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const supabase = await createRequestScopedClient(request);
  const { data: id, error } = await supabase.rpc('partner_submit_pitch', parsed.value);
  if (error) {
    const r = pitchErrorResponse(error);
    if (r.status === 500) console.error('[portal pitches] submit failed', error.message);
    return NextResponse.json({ error: r.error }, { status: r.status });
  }

  const v = parsed.value;
  try {
    await sendInternalNotification({
      formType: 'date_pitch',
      data: {
        programmer: partner.contact_display_name || partner.full_name || '',
        date: longDateLabel(v.p_date),
        event_name: v.p_title,
        time: timeRangeLabel(v.p_start_time, v.p_end_time),
        expected_attendance: attendanceLabel(v.p_expected_attendance),
        concept: v.p_concept,
        proposed_lineup: v.p_lineup || '',
        anything_else: v.p_notes || '',
      },
    });
  } catch (err) {
    console.error('[portal pitches] internal notification failed', err?.message || err);
  }

  return NextResponse.json({ id }, { status: 201 });
}
