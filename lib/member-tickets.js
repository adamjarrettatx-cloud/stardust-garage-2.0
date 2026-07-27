// Flattening of TicketTailor `issued_tickets` into public.member_tickets, the
// read-facing ticket wallet the mobile app queries under RLS (see
// supabase/migrations/20260727_member_tickets.sql for the data model rationale).
//
// Shared by two callers so a backfilled row is indistinguishable from a
// webhook-written one:
//   - app/api/webhooks/tickettailor/route.js  (live ORDER.CREATED/UPDATED)
//   - scripts/backfill-member-tickets.mjs     (historical raw_payload replay)
//
// The row mapping is pure and unit-tested; the two Supabase calls
// (member_profiles lookup, member_tickets upsert) live at the bottom because
// both callers need them identically. Same lib/route split as
// lib/tt-order-backfill.js.

// TicketTailor sends booleans as the STRINGS "true"/"false" on issued tickets,
// while the column is a real boolean. Anything unrecognized is false rather
// than null, since the column is NOT NULL and "not checked in" is the safe
// default for a wallet.
export function parseTtBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
}

// TT timestamps are unix SECONDS (the webhook already reads order.created_at
// that way). An ISO string is accepted as a fallback so a shape change does not
// silently drop the value.
export function ttTimestampToIso(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1000).toISOString();
  if (typeof raw !== 'string') return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export function normalizeEmail(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

// Every distinct lowercased email an order's tickets could be attributed to.
// Tickets carry their own email (guest tickets in a group order), falling back
// to the buyer.
export function issuedTicketEmails(order) {
  const buyerEmail = normalizeEmail(order?.buyer_details?.email);
  const tickets = Array.isArray(order?.issued_tickets) ? order.issued_tickets : [];
  const emails = new Set();
  for (const ticket of tickets) {
    const email = normalizeEmail(ticket?.email) || buyerEmail;
    if (email) emails.add(email);
  }
  return [...emails];
}

// One TT order -> its member_tickets rows. Returns [] for pending orders, whose
// `issued_tickets` is absent until the order completes.
//
// `memberIdByEmail` maps lowercased email -> member_profiles.id. A miss is
// expected and fine: member_id is a best-effort convenience column, and RLS
// authorizes on buyer_email instead, so a ticket bought before signup still
// resolves once that person signs in with the same address.
export function buildMemberTicketRows(order, { localEventId = null, memberIdByEmail = new Map(), orderStatus } = {}) {
  const ttOrderId = order?.id;
  if (!ttOrderId) return [];

  const tickets = Array.isArray(order?.issued_tickets) ? order.issued_tickets : [];
  const buyerEmail = normalizeEmail(order?.buyer_details?.email);
  const parentStatus = orderStatus ?? order?.status;
  const normalizedParentStatus = typeof parentStatus === 'string' ? parentStatus.toLowerCase() : null;

  const rows = [];
  const seen = new Set();
  for (const ticket of tickets) {
    const id = ticket?.id ? String(ticket.id) : null;
    // No id means no primary key and no idempotency key, and buyer_email is
    // NOT NULL — either way there is nothing safe to write, so skip the ticket
    // rather than invent a value.
    if (!id || seen.has(id)) continue;
    const email = normalizeEmail(ticket.email) || buyerEmail;
    if (!email) continue;
    seen.add(id);

    rows.push({
      id,
      tt_order_id: String(ttOrderId),
      tt_event_id: ticket.event_id || order?.event_summary?.event_id || null,
      local_event_id: localEventId || null,
      member_id: memberIdByEmail.get(email) || null,
      buyer_email: email,
      ticket_type_id: ticket.ticket_type_id || null,
      description: ticket.description || null,
      status: typeof ticket.status === 'string' && ticket.status.trim() ? ticket.status.trim().toLowerCase() : 'valid',
      checked_in: parseTtBoolean(ticket.checked_in),
      barcode: ticket.barcode || null,
      barcode_url: ticket.barcode_url || null,
      qr_code_url: ticket.qr_code_url || null,
      voided_at: ttTimestampToIso(ticket.voided_at),
      order_status: normalizedParentStatus,
    });
  }
  return rows;
}

export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// member_profiles.email is not guaranteed lowercase, so match case-insensitively
// with an ilike OR-group rather than `.in()`. Values are double-quoted because
// PostgREST treats `,` and `.` as filter syntax; the handful of addresses that
// could break out of that quoting (embedded quote or backslash) are dropped
// instead of interpolated.
const EMAIL_FILTER_CHUNK = 50;
const UNSAFE_FOR_POSTGREST = /["\\]/;

export async function loadMemberIdsByEmail(supabase, emails) {
  const byEmail = new Map();
  const safe = emails.filter((email) => !UNSAFE_FOR_POSTGREST.test(email));
  for (const group of chunk(safe, EMAIL_FILTER_CHUNK)) {
    const filter = group.map((email) => `email.ilike."${email}"`).join(',');
    const { data, error } = await supabase.from('member_profiles').select('id, email').or(filter);
    if (error) throw new Error(`member_profiles lookup failed: ${error.message}`);
    for (const profile of data || []) {
      const email = normalizeEmail(profile.email);
      if (email && !byEmail.has(email)) byEmail.set(email, profile.id);
    }
  }
  return byEmail;
}

// Upserts an order's tickets and returns how many rows were written. Requires a
// service-role client: member_tickets RLS has no insert path for anon/auth
// users. The caller must have already written the parent
// ticket_order_attribution row — member_tickets.tt_order_id references it.
export async function syncMemberTicketsForOrder(supabase, order, options = {}) {
  const emails = issuedTicketEmails(order);
  const memberIdByEmail = emails.length ? await loadMemberIdsByEmail(supabase, emails) : new Map();
  const rows = buildMemberTicketRows(order, { ...options, memberIdByEmail });
  if (rows.length === 0) return 0;

  const { error } = await supabase.from('member_tickets').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`member_tickets upsert failed: ${error.message}`);
  return rows.length;
}
