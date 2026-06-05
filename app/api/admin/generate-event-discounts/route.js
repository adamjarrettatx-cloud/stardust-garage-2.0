import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getEventSeriesTicketTypes } from '@/lib/tickettailor';
import {
  QUALIFYING_CATEGORIES,
  getEligibleMembers,
  createCodeForMember,
  getDiscountPercent,
} from '@/lib/discountCodeUtils';

export const runtime = 'nodejs';

// POST /api/admin/generate-event-discounts
// Body: { eventId: string, force?: boolean }
// Generates one single-use TicketTailor discount code per eligible member.
// When force is true (manual "Generate Member Codes" button), the
// discount_codes_generated check is skipped so the run only fills in codes for
// members who don't yet have one — safe to invoke repeatedly.
export async function POST(request) {
  try {
    const serverClient = await createServerClient();
    const { data: { user: adminUser } } = await serverClient.auth.getUser();
    if (!adminUser || !adminUser.user_metadata?.is_admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { eventId, force } = await request.json();
    if (!eventId) {
      return NextResponse.json({ error: 'Missing eventId' }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: event, error: eventError } = await supabaseAdmin
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single();
    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    if (!QUALIFYING_CATEGORIES.includes(event.category)) {
      return NextResponse.json({ skipped: true, reason: 'category' });
    }
    if (!event.tt_event_series_id) {
      return NextResponse.json({ skipped: true, reason: 'no_tt_series' });
    }
    if (!force && event.discount_codes_generated) {
      return NextResponse.json({ skipped: true, reason: 'already_generated' });
    }

    const ticketTypeIds = await getEventSeriesTicketTypes(event.tt_event_series_id);
    const members = await getEligibleMembers(supabaseAdmin);
    const discountPercent = getDiscountPercent(event.category, event.member_discount_percent);

    let codesGenerated = 0;
    const errors = [];
    for (const member of members) {
      try {
        const row = await createCodeForMember({
          supabaseAdmin,
          event,
          member,
          ticketTypeIds,
          discountPercent,
        });
        if (row) codesGenerated++;
      } catch (err) {
        console.error(
          `Failed to generate code for member ${member.id} (${member.email}):`,
          err?.message || err
        );
        errors.push({ memberId: member.id, error: err?.message || 'unknown' });
      }
    }

    await supabaseAdmin
      .from('events')
      .update({ discount_codes_generated: true })
      .eq('id', event.id);

    return NextResponse.json({ success: true, codesGenerated, errors });
  } catch (err) {
    console.error('generate-event-discounts route error:', err);
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || 'unknown') },
      { status: 500 }
    );
  }
}
