import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/admin/pay-requests — every pay request, newest first, decorated
// with the contact/event/booking an admin needs to review or a CPA needs for
// the 1099 view. One list serves both the "Review & Pay" tab (filter to
// pending_review client-side) and the "1099 Tracking" tab (filter to paid) —
// avoids two near-identical routes for what is really one dataset viewed two
// ways.
//
// W9-on-file status is queried defensively: contact_tax_profiles is Phase 1's
// table (PR #91) and is not merged/applied yet. Wrapping the lookup in a
// try/catch means Phase 3 works whether or not Phase 1 has landed, instead of
// repeating the cross-phase-dependency bug just fixed in PR #92.
export async function GET() {
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });

  const admin = createAdminClient();

  const { data: requests, error } = await admin
    .from('artist_pay_requests')
    .select(
      `
      id, booking_id, event_id, contact_id, pay_type, amount_cents, status,
      requested_by, reviewed_by, reviewed_at, rejection_reason, created_at, updated_at,
      contact:contact_id ( display_name, company, email ),
      event:event_id ( title, event_date ),
      booking:booking_id ( slot_start, slot_end, status )
    `
    )
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[pay-requests.list]', error);
    return NextResponse.json({ error: 'Could not load pay requests' }, { status: 500 });
  }

  const contactIds = Array.from(new Set((requests || []).map((r) => r.contact_id)));
  let w9ByContact = {};
  if (contactIds.length) {
    try {
      const { data: profiles, error: taxError } = await admin
        .from('contact_tax_profiles')
        .select('contact_id, w9_on_file')
        .in('contact_id', contactIds);
      if (!taxError) {
        w9ByContact = Object.fromEntries((profiles || []).map((p) => [p.contact_id, Boolean(p.w9_on_file)]));
      }
    } catch (err) {
      // Phase 1's table isn't there yet (or a column name changed before it
      // merged) — the 1099 view just shows "Unknown" for W9 status rather
      // than failing this entire route.
      console.warn('[pay-requests.list] contact_tax_profiles lookup skipped', err?.message || err);
    }
  }

  return NextResponse.json({
    ok: true,
    requests: (requests || []).map((r) => ({ ...r, w9_on_file: w9ByContact[r.contact_id] ?? null })),
  });
}
