import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getEventSeriesTicketTypes } from '@/lib/tickettailor';
import {
  QUALIFYING_CATEGORIES,
  createCodeForMember,
} from '@/lib/discountCodeUtils';

export const runtime = 'nodejs';

function todayDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// POST /api/admin/check-new-member-codes
// Body: { memberId: string }
// When a member becomes active, back-fill codes for upcoming qualifying events
// whose 3-day send window has not yet passed.
export async function POST(request) {
  try {
    const serverClient = await createServerClient();
    const { data: { user: adminUser } } = await serverClient.auth.getUser();
    if (!adminUser || !adminUser.user_metadata?.is_admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { memberId } = await request.json();
    if (!memberId) {
      return NextResponse.json({ error: 'Missing memberId' }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: member, error: memberError } = await supabaseAdmin
      .from('member_profiles')
      .select('id, user_id, full_name, email, is_active, subscription_status')
      .eq('id', memberId)
      .single();
    if (memberError || !member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    // Only eligible members get codes.
    if (!(member.is_active && member.subscription_status === 'active')) {
      return NextResponse.json({ skipped: true, reason: 'not_eligible' });
    }

    const today = todayDateString();

    // Upcoming qualifying events that already have codes generated and whose
    // send date hasn't passed yet (send_scheduled_for >= today via the codes,
    // here approximated by event_date >= today + 3 isn't required; we use the
    // existing rows' schedule to bound it). Filter on event_date >= today.
    const { data: events, error: eventsError } = await supabaseAdmin
      .from('events')
      .select('*')
      .gte('event_date', today)
      .eq('discount_codes_generated', true)
      .in('category', QUALIFYING_CATEGORIES);
    if (eventsError) {
      throw new Error('Failed to load events: ' + eventsError.message);
    }

    let codesGenerated = 0;
    const errors = [];
    for (const event of events || []) {
      if (!event.tt_event_series_id) continue;
      // Skip events whose send window has already passed (3 days before).
      const [y, m, d] = String(event.event_date).split('-').map(Number);
      const sendDt = new Date(Date.UTC(y, m - 1, d));
      sendDt.setUTCDate(sendDt.getUTCDate() - 3);
      const sendStr = sendDt.toISOString().slice(0, 10);
      if (sendStr < today) continue;

      try {
        const ticketTypeIds = await getEventSeriesTicketTypes(event.tt_event_series_id);
        const row = await createCodeForMember({
          supabaseAdmin,
          event,
          member,
          ticketTypeIds,
        });
        if (row) codesGenerated++;
      } catch (err) {
        console.error(
          `check-new-member-codes failed for event ${event.id}:`,
          err?.message || err
        );
        errors.push({ eventId: event.id, error: err?.message || 'unknown' });
      }
    }

    return NextResponse.json({ success: true, codesGenerated, errors });
  } catch (err) {
    console.error('check-new-member-codes route error:', err);
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || 'unknown') },
      { status: 500 }
    );
  }
}
