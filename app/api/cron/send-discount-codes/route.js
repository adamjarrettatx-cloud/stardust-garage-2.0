import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendDiscountCode } from '@/lib/email';
import { getEventSeriesTicketTypes } from '@/lib/tickettailor';
import {
  QUALIFYING_CATEGORIES,
  getEligibleMembers,
  createCodeForMember,
} from '@/lib/discountCodeUtils';

export const runtime = 'nodejs';

// Returns 'YYYY-MM-DD' for the given Date in America/Chicago (Austin) time.
function austinDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// Adds `days` to a 'YYYY-MM-DD' string and returns 'YYYY-MM-DD' (UTC math).
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

async function emailCodeRow(supabaseAdmin, row) {
  const event = row.events;
  const member = row.member_profiles;
  await sendDiscountCode({
    email: row.member_email || member?.email,
    fullName: member?.full_name,
    eventTitle: event?.title,
    eventDate: event?.event_date,
    eventTime: event?.event_time,
    code: row.tt_discount_code,
    ticketUrl: event?.ticket_url,
  });
  await supabaseAdmin
    .from('member_discount_codes')
    .update({ sent_at: new Date().toISOString() })
    .eq('id', row.id);
}

// GET /api/cron/send-discount-codes
// Daily Vercel cron. Sends codes scheduled for today and catches new members.
export async function GET(request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const today = austinDateString();

    // 1. Catch new members: events sending in 3 days that already have codes
    //    generated but newly-eligible members who don't yet have one.
    const eventDateForToday = addDays(today, 3);
    let newMemberCodes = 0;

    const { data: upcomingEvents, error: upcomingError } = await supabaseAdmin
      .from('events')
      .select('*')
      .eq('event_date', eventDateForToday)
      .eq('discount_codes_generated', true)
      .in('category', QUALIFYING_CATEGORIES);
    if (upcomingError) {
      throw new Error('Failed to load upcoming events: ' + upcomingError.message);
    }

    for (const event of upcomingEvents || []) {
      if (!event.tt_event_series_id) continue;
      let ticketTypeIds;
      try {
        ticketTypeIds = await getEventSeriesTicketTypes(event.tt_event_series_id);
      } catch (err) {
        console.error(`Failed to load ticket types for event ${event.id}:`, err?.message || err);
        continue;
      }
      const members = await getEligibleMembers(supabaseAdmin);
      for (const member of members) {
        try {
          const row = await createCodeForMember({
            supabaseAdmin,
            event,
            member,
            ticketTypeIds,
          });
          if (row) {
            // Send immediately since the 3-day window is now.
            await emailCodeRow(supabaseAdmin, {
              ...row,
              events: event,
              member_profiles: member,
            });
            newMemberCodes++;
          }
        } catch (err) {
          console.error(
            `New-member code failed for ${member.id} on event ${event.id}:`,
            err?.message || err
          );
        }
      }
    }

    // 2. Send all codes scheduled for today that haven't been sent.
    const { data: dueCodes, error: dueError } = await supabaseAdmin
      .from('member_discount_codes')
      .select(
        'id, member_email, tt_discount_code, ' +
          'events ( title, event_date, event_time, ticket_url ), ' +
          'member_profiles ( full_name, email )'
      )
      .eq('send_scheduled_for', today)
      .is('sent_at', null);
    if (dueError) {
      throw new Error('Failed to load due codes: ' + dueError.message);
    }

    let sent = 0;
    for (const row of dueCodes || []) {
      try {
        await emailCodeRow(supabaseAdmin, row);
        sent++;
      } catch (err) {
        console.error(`Failed to send code ${row.id}:`, err?.message || err);
      }
    }

    return NextResponse.json({ success: true, sent, newMemberCodes });
  } catch (err) {
    console.error('send-discount-codes cron error:', err);
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || 'unknown') },
      { status: 500 }
    );
  }
}
