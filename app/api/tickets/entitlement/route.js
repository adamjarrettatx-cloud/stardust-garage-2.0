import { NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveBuyerEntitlement } from '@/lib/tickets/entitlement-lookup';
import { resolveEntitlementPercent, entitlementLabel } from '@/lib/tickets/entitlement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/tickets/entitlement?event_id=<uuid>
// Auth: getRequestUser(), the same resolver /api/tickets/hold uses, so the
// preview and the charge agree on who is asking. Anonymous callers get a plain
// "no entitlement" answer rather than a 401 — the ticket widget renders for
// guests too, and an error there would be noise.
//
// This is a DISPLAY endpoint only. /api/tickets/hold re-resolves the same
// entitlement server-side and that result is the one the buyer is charged
// under, so a tampered response here cannot move money.
export async function GET(request) {
  const eventId = new URL(request.url).searchParams.get('event_id');
  const none = { entitled: false, percent: 0, label: null, kind: null };
  if (!eventId) {
    return NextResponse.json({ error: 'Missing event_id' }, { status: 400 });
  }

  const user = await getRequestUser(request);
  if (!user) return NextResponse.json(none);

  const admin = createAdminClient();

  const { data: event } = await admin
    .from('events')
    .select('id, is_weekend_music_experience, member_discount_percent_trial, member_discount_percent_weekender, member_discount_percent_cowork, member_discount_percent_iykyk')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  let entitlement = null;
  try {
    entitlement = await resolveBuyerEntitlement(admin, user.id);
  } catch (err) {
    console.error('[tickets.entitlement]', err?.message || err);
    return NextResponse.json(none);
  }

  const percent = resolveEntitlementPercent(event, entitlement);
  if (!percent) return NextResponse.json(none);

  return NextResponse.json({
    entitled: true,
    percent,
    kind: entitlement?.kind || null,
    label: entitlementLabel(entitlement, percent),
  });
}
