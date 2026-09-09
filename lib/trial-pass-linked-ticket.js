// Given a trial pass and an event, find any single ticket for that event
// that should be checked in when the pass holder scans at the door.
//
// Same idea as findMemberLinkedTicket, adapted for trial passes:
//
//   1. If the pass has been converted to a paid membership, match on that
//      member_profile_id first (orders.member_profile_id).
//   2. Otherwise (or additionally) match on the pass's email
//      (orders.buyer_email, case-insensitive).
//
// We only surface tickets whose status is 'valid'. If multiple valid
// tickets are found for the same event we pick the oldest so re-scans
// stay deterministic.
//
// Returns:
//   {
//     ticket:       { id, ticket_code, status, product_id, order_id } | null,
//     productLabel: string | null,
//     matchedVia:   'member_profile_id' | 'buyer_email' | null,
//     candidateCount: number,
//   }
//
// Never throws — errors return the empty shape so the door decision is
// never blocked by this lookup.

export async function findTrialPassLinkedTicket(admin, { passMemberProfileId, passEmail, eventId }) {
  const empty = { ticket: null, productLabel: null, matchedVia: null, candidateCount: 0 };
  if (!admin || !eventId) return empty;
  if (!passMemberProfileId && !passEmail) return empty;

  try {
    const orderIds = new Set();
    let memberOrderIds = new Set();

    if (passMemberProfileId) {
      const byMember = await admin
        .from('orders')
        .select('id')
        .eq('event_id', eventId)
        .eq('member_profile_id', passMemberProfileId);
      memberOrderIds = new Set((byMember?.data || []).map((o) => o.id));
      for (const id of memberOrderIds) orderIds.add(id);
    }

    if (passEmail) {
      const emailCanon = String(passEmail).trim().toLowerCase();
      if (emailCanon) {
        const byEmail = await admin
          .from('orders')
          .select('id')
          .eq('event_id', eventId)
          .ilike('buyer_email', emailCanon);
        for (const row of byEmail?.data || []) orderIds.add(row.id);
      }
    }

    if (orderIds.size === 0) return empty;

    const { data: tickets } = await admin
      .from('tickets')
      .select('id, ticket_code, status, product_id, order_id, created_at')
      .in('order_id', Array.from(orderIds))
      .eq('event_id', eventId)
      .eq('status', 'valid')
      .order('created_at', { ascending: true });

    if (!tickets || tickets.length === 0) return empty;

    const chosen = tickets[0];

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
    console.error('[trial-pass-linked-ticket]', err?.message || err);
    return empty;
  }
}
