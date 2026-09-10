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
  normalizeMemberIdRow,
  normalizeDenialRow,
} from '@/lib/capacity/checkin-feed';
import {
  DENYING_TICKET_RESULTS,
  DENYING_TRIAL_PASS_RESULTS,
  DENYING_MEMBER_ID_RESULTS,
  denialLabel,
} from '@/lib/capacity/denial-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/capacity/checkins?eventId=<uuid>
//
// Everyone who came to the door during the current session -- admitted AND
// turned away -- newest first, as a single stream across the four places a scan
// gets written:
//
//   event_guestlist_entries  (status='checked_in')      -> kind 'guestlist'
//   ticket_checkins          (valid/override + denials) -> kind 'ticket'
//   trial_pass_checkins      (allowed + denials)        -> kind 'trial_pass'
//   member_id_scans          (verified + rejected)      -> kind 'member_id'
//
// DENIALS ARE INCLUDED, and that is the point of the endpoint's second draft.
// A denial used to exist only on the scanner's red result card, which clears
// after a few seconds. If a guest was refused and drifted back twenty minutes
// later to a different door person, nothing on screen said so. Now every
// refusal is a row, keyed by the SCAN rather than the subject so repeat
// attempts stack up instead of overwriting each other.
//
// Guest-list entries have no denial concept -- an entry is either checked in or
// it is not -- so that source contributes admits only.
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
      .select('id, ticket_id, ticket_code_attempted, result, reject_reason, scanned_at, event_id')
      .in('result', [...ADMITTING_TICKET_RESULTS, ...DENYING_TICKET_RESULTS])
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
          .select('id, buyer_name')
          .in('id', orderIds);
        buyerByOrder = new Map((orders || []).map((o) => [o.id, o]));
      }
      for (const row of rows) {
        const buyer = buyerByOrder.get(orderIdByTicket.get(row.ticket_id)) || {};
        if (DENYING_TICKET_RESULTS.includes(row.result)) {
          // A not_found scan has no ticket and therefore no buyer, so the code
          // that was presented is the only identifying thing we can show.
          const name = buyer.buyer_name
            || (row.ticket_code_attempted ? `Code ${row.ticket_code_attempted}` : null);
          const entry = normalizeDenialRow({
            id: row.id,
            at: new Date(row.scanned_at).getTime(),
            kind: 'ticket',
            name,
            label: denialLabel(row.result, row.reject_reason),
          });
          if (entry) entries.push(entry);
          continue;
        }
        const entry = normalizeTicketRow(row, {
          buyerName: buyer.buyer_name,
        });
        if (entry) entries.push(entry);
      }
    }
  }

  // ---- Trial passes -----------------------------------------------------
  {
    let query = admin
      .from('trial_pass_checkins')
      .select('id, trial_pass_id, result, reject_reason, checked_in_at')
      .in('result', [...ADMITTING_TRIAL_PASS_RESULTS, ...DENYING_TRIAL_PASS_RESULTS])
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
        if (DENYING_TRIAL_PASS_RESULTS.includes(row.result)) {
          const entry = normalizeDenialRow({
            id: row.id,
            at: new Date(row.checked_in_at).getTime(),
            kind: 'trial_pass',
            name: nameByPass.get(row.trial_pass_id),
            label: denialLabel(row.result, row.reject_reason),
          });
          if (entry) entries.push(entry);
          continue;
        }
        const entry = normalizeTrialPassRow(row, { fullName: nameByPass.get(row.trial_pass_id) });
        if (entry) entries.push(entry);
      }
    }
  }

  // ---- Member IDs -------------------------------------------------------
  // Previously absent from this feed with the note "nothing persists them
  // server-side". That is no longer true -- member_id_scans records both
  // verifies and rejections -- so a member verified on the door tablet now
  // shows up on the front-desk laptop too.
  {
    let query = admin
      .from('member_id_scans')
      .select('id, member_profile_id, result, reject_reason, scanned_at')
      .in('result', ['verified', ...DENYING_MEMBER_ID_RESULTS])
      .order('scanned_at', { ascending: false })
      .limit(CHECKIN_FEED_MAX);
    if (doorSessionId) query = query.eq('door_session_id', doorSessionId);
    else query = query.eq('event_id', eventId).gte('scanned_at', sinceIso);

    const { data: rows, error } = await query;
    if (error) {
      console.error('[capacity.checkins.member_ids]', error);
    } else if (rows && rows.length > 0) {
      const profileIds = [...new Set(rows.map((r) => r.member_profile_id).filter(Boolean))];
      const { data: profiles } = await admin
        .from('member_profiles')
        .select('id, full_name')
        .in('id', profileIds);
      const nameByProfile = new Map((profiles || []).map((m) => [m.id, m.full_name]));
      for (const row of rows) {
        const name = nameByProfile.get(row.member_profile_id);
        if (DENYING_MEMBER_ID_RESULTS.includes(row.result)) {
          const entry = normalizeDenialRow({
            id: row.id,
            at: new Date(row.scanned_at).getTime(),
            kind: 'member_id',
            name,
            label: denialLabel(row.result, row.reject_reason),
          });
          if (entry) entries.push(entry);
          continue;
        }
        const entry = normalizeMemberIdRow(row, { fullName: name });
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
