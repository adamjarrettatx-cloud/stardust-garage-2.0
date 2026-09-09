// Given a member and an event, find any single ticket for that event that
// should be checked in when the member scans their Member ID at the door.
//
// The lookup has two paths, in preference order:
//
//   1. orders.member_profile_id = member.id  AND  orders.event_id = event
//      (Buyer was signed in as a member when they bought.)
//   2. lower(orders.buyer_email) = lower(member.email)  AND  orders.event_id = event
//      (Buyer used the same email but wasn't signed in — very common:
//      user bought before they became a member, or Stripe Guest checkout.)
//
// We only surface tickets whose status is 'valid'. If a member bought
// multiple tickets to the same event we pick the oldest still-valid one
// (deterministic, first-in-first-out). Everything else about the ticket
// stays intact for future scans if needed.
//
// Returns:
//   {
//     ticket:       { id, ticket_code, status, product_id, order_id } | null,
//     productLabel: string | null,     // "General Admission" etc, for the card
//     matchedVia:   'member_profile_id' | 'buyer_email' | null,
//     candidateCount: number,          // total valid tickets found; helps future UI
//   }
//
// Never throws — a lookup failure returns { ticket: null, ... } so the
// scanner still admits the member on their base credential.

export async function findMemberLinkedTicket(admin, { memberProfileId, memberEmail, eventId }) {
  const empty = { ticket: null, productLabel: null, matchedVia: null, candidateCount: 0 };
  if (!admin || !memberProfileId || !eventId) return empty;

  try {
    // Path 1: orders bought by this member (signed in).
    const byMember = await admin
      .from('orders')
      .select('id, member_profile_id, buyer_email')
      .eq('event_id', eventId)
      .eq('member_profile_id', memberProfileId);

    const orderIds = new Set((byMember?.data || []).map((o) => o.id));

    // Path 2: orders that used this member's email (guest / pre-membership).
    if (memberEmail) {
      const emailCanon = String(memberEmail).trim().toLowerCase();
      if (emailCanon) {
        const byEmail = await admin
          .from('orders')
          .select('id, member_profile_id, buyer_email')
          .eq('event_id', eventId)
          .ilike('buyer_email', emailCanon);
        for (const row of byEmail?.data || []) {
          orderIds.add(row.id);
        }
      }
    }

    if (orderIds.size === 0) return empty;

    // Pull every valid ticket in those orders for this event. Choose the
    // oldest so re-scans stay deterministic if the member somehow buys
    // multiple.
    const { data: tickets } = await admin
      .from('tickets')
      .select('id, ticket_code, status, product_id, order_id, created_at')
      .in('order_id', Array.from(orderIds))
      .eq('event_id', eventId)
      .eq('status', 'valid')
      .order('created_at', { ascending: true });

    if (!tickets || tickets.length === 0) return empty;

    const chosen = tickets[0];

    // Best-effort product label (never blocks the scan).
    let productLabel = null;
    if (chosen.product_id) {
      try {
        const { data: product } = await admin
          .from('ticket_products')
          .select('name')
          .eq('id', chosen.product_id)
          .maybeSingle();
        productLabel = product?.name || null;
      } catch {
        productLabel = null;
      }
    }

    // Figure out which path matched (for the audit log / future UI).
    const memberOrderIds = new Set((byMember?.data || []).map((o) => o.id));
    const matchedVia = memberOrderIds.has(chosen.order_id) ? 'member_profile_id' : 'buyer_email';

    return {
      ticket: {
        id: chosen.id,
        ticket_code: chosen.ticket_code,
        status: chosen.status,
        product_id: chosen.product_id,
        order_id: chosen.order_id,
      },
      productLabel,
      matchedVia,
      candidateCount: tickets.length,
    };
  } catch (err) {
    console.error('[member-id-linked-ticket]', err?.message || err);
    return empty;
  }
}
