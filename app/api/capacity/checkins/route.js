import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { requireTeam } from '@/lib/auth-helpers';
import { getActiveDoorSession } from '@/lib/door-session';
import {
  CHECKIN_FEED_MAX,
  ADMITTING_TICKET_RESULTS,
  ADMITTING_TRIAL_PASS_RESULTS,
  normalizeGuestlistRow,
  normalizeTicketRow,
  normalizeTrialPassRow,
} from '@/lib/capacity/checkin-feed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/capacity/checkins?eventId=<uuid>
//
// Everyone admitted during the current door session, newest first, as a single
// stream across the three places a check-in gets written:
//
//   event_guestlist_entries  (status='checked_in')  -> kind 'guestlist'
//   ticket_checkins          (result valid/override) -> kind 'ticket'
//   trial_pass_checkins      (result 'allowed')      -> kind 'trial_pass'
//
// This backs the front-desk "Checked in" panel, which previously only knew
// about check-ins performed in that one browser tab. Member-ID verifies are
// deliberately absent: nothing persists them server-side, so they remain
// local-only in the client buffer.
//
// SCOPE. When a door session is open, ticket and trial-pass rows are scoped by
// door_session_id -- that is exactly "tonight" as the staff mean it, and it
// stays correct for a recurring event that has run before. Guest-list entries
// carry no session id, so they are scoped to the session's event. With no
// session open we fall back to ?eventId= plus a 12-hour floor so the panel
// shows recent activity without replaying an old night.
//
// WHY THE SERVICE-ROLE CLIENT. ticket_checkins, trial_passes and orders are
// admin-only under RLS, but the door is worked by team members who are not
// admins -- a user-scoped read would silently return an empty list for them,
// which is the exact bug this endpoint fixes. requireTeam() gates the route and
// only the narrow display fields below are ever returned. Door staff already
// see these names on the scanner as each guest walks up.
const FALLBACK_WINDOW_MS = 12 * 60 * 60 * 1000;

export async function GET(request) {
  const { unauthorized } = await requireTeam();
  if (unauthorized) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured in this environment.' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const requestedEventId = searchParams.get('eventId') || null;

  const admin = createAdminClient();

  const session = await getActiveDoorSession(admin);
  const doorSessionId = session?.id || null;
  const eventId = session?.event_id || requestedEventId;

  if (!doorSessionId && !eventId) {
    return NextResponse.json({ ok: true, entries: [], doorSessionId: null, eventId: null });
  }

  const sinceIso = new Date(Date.now() - FALLBACK_WINDOW_MS).toISOString();
  const entries = [];

  // ---- Guest list -------------------------------------------------------
  // Scoped through grants because entries hang off a grant, not an event.
  if (eventId) {
    const { data: grants, error: grantsError } = await admin
      .from('event_guestlist_grants')
      .select('id, contact_id')
      .eq('event_id', eventId);
    if (grantsError) {
      console.error('[capacity.checkins.grants]', grantsError);
    } else if (grants && grants.length > 0) {
      const contactIds = [...new Set(grants.map((g) => g.contact_id).filter(Boolean))];
      let namesByContact = new Map();
      if (contactIds.length > 0) {
        const { data: contacts } = await admin
          .from('contacts')
          .select('id, display_name')
          .in('id', contactIds);
        namesByContact = new Map((contacts || []).map((c) => [c.id, c.display_name]));
      }
      const grantById = new Map(grants.map((g) => [g.id, g]));

      const { data: rows, error: rowsError } = await admin
        .from('event_guestlist_entries')
        .select('id, grant_id, guest_name, status, checked_in_at')
        .in('grant_id', [...grantById.keys()])
        .eq('status', 'checked_in')
        .not('checked_in_at', 'is', null)
        .order('checked_in_at', { ascending: false })
        .limit(CHECKIN_FEED_MAX);
      if (rowsError) {
        console.error('[capacity.checkins.guestlist]', rowsError);
      } else {
        for (const row of rows || []) {
          const grant = grantById.get(row.grant_id);
          const partnerName = grant ? namesByContact.get(grant.contact_id) : null;
          const entry = normalizeGuestlistRow(row, { partnerName });
          if (entry) entries.push(entry);
        }
      }
    }
  }

  // ---- Tickets ----------------------------------------------------------
  // The holder's name lives on the order, not the ticket: nothing in the
  // purchase flow sets tickets.attendee_id, so orders.buyer_name is the only
  // name we have. Two hops (checkins -> tickets -> orders) rather than a
  // nested select so a missing order never drops the row entirely.
  {
    let query = admin
      .from('ticket_checkins')
      .select('ticket_id, result, scanned_at')
      .in('result', ADMITTING_TICKET_RESULTS)
      .order('scanned_at', { ascending: false })
      .limit(CHECKIN_FEED_MAX);
    if (doorSessionId) query = query.eq('door_session_id', doorSessionId);
    else query = query.eq('event_id', eventId).gte('scanned_at', sinceIso);

    const { data: rows, error } = await query;
    if (error) {
      console.error('[capacity.checkins.tickets]', error);
    } else if (rows && rows.length > 0) {
      const ticketIds = [...new Set(rows.map((r) => r.ticket_id).filter(Boolean))];
      const { data: tickets } = await admin
        .from('tickets')
        .select('id, order_id')
        .in('id', ticketIds);
      const orderIdByTicket = new Map((tickets || []).map((t) => [t.id, t.order_id]));
      const orderIds = [...new Set([...orderIdByTicket.values()].filter(Boolean))];
      let buyerByOrder = new Map();
      if (orderIds.length > 0) {
        const { data: orders } = await admin
          .from('orders')
          .select('id, buyer_name, buyer_email')
          .in('id', orderIds);
        buyerByOrder = new Map((orders || []).map((o) => [o.id, o]));
      }
      for (const row of rows) {
        const buyer = buyerByOrder.get(orderIdByTicket.get(row.ticket_id)) || {};
        const entry = normalizeTicketRow(row, {
          buyerName: buyer.buyer_name,
          buyerEmail: buyer.buyer_email,
        });
        if (entry) entries.push(entry);
      }
    }
  }

  // ---- Trial passes -----------------------------------------------------
  {
    let query = admin
      .from('trial_pass_checkins')
      .select('trial_pass_id, result, checked_in_at')
      .in('result', ADMITTING_TRIAL_PASS_RESULTS)
      .order('checked_in_at', { ascending: false })
      .limit(CHECKIN_FEED_MAX);
    if (doorSessionId) query = query.eq('door_session_id', doorSessionId);
    else query = query.eq('event_id', eventId).gte('checked_in_at', sinceIso);

    const { data: rows, error } = await query;
    if (error) {
      console.error('[capacity.checkins.trial_passes]', error);
    } else if (rows && rows.length > 0) {
      const passIds = [...new Set(rows.map((r) => r.trial_pass_id).filter(Boolean))];
      const { data: passes } = await admin
        .from('trial_passes')
        .select('id, full_name')
        .in('id', passIds);
      const nameByPass = new Map((passes || []).map((p) => [p.id, p.full_name]));
      for (const row of rows) {
        const entry = normalizeTrialPassRow(row, { fullName: nameByPass.get(row.trial_pass_id) });
        if (entry) entries.push(entry);
      }
    }
  }

  entries.sort((a, b) => (b.at || 0) - (a.at || 0));

  return NextResponse.json({
    ok: true,
    doorSessionId,
    eventId: eventId || null,
    entries: entries.slice(0, CHECKIN_FEED_MAX),
  });
}
