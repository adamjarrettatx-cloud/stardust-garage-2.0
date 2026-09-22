import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { payoutAccess, payoutDatabaseError } from '@/lib/artist-payout-server';
import { PAYOUT_UUID, validRecipientLink } from '@/lib/artist-payout-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const access = await payoutAccess(request, { write: false });
  if (access.response) return access.response;
  const { id } = await params;
  if (!PAYOUT_UUID.test(id)) return NextResponse.json({ error: 'Bad id.' }, { status: 400 });
  const { data, error } = await createAdminClient().from('contact_payout_profiles')
    .select('contact_id, mercury_recipient_id, linked_at')
    .eq('contact_id', id).maybeSingle();
  if (error) return payoutDatabaseError(error);
  return NextResponse.json({ profile: data || null }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request, { params }) {
  const access = await payoutAccess(request);
  if (access.response) return access.response;
  const { id } = await params;
  if (!PAYOUT_UUID.test(id)) return NextResponse.json({ error: 'Bad id.' }, { status: 400 });
  const body = await request.json().catch(() => null);
  if (!validRecipientLink(body)) {
    return NextResponse.json({ error: 'Enter a Mercury recipient ID and confirm the recipient in Mercury. Banking details are not accepted.' }, { status: 400 });
  }
  const { data, error } = await createAdminClient().rpc('link_artist_mercury_recipient', {
    p_contact_id: id, p_recipient_id: body.mercury_recipient_id.toLowerCase(), p_actor_id: access.user.id,
  });
  if (error || !data) return payoutDatabaseError(error);
  return NextResponse.json({ ok: true, profile: {
    contact_id: data.contact_id, mercury_recipient_id: data.mercury_recipient_id, linked_at: data.linked_at,
  } });
}
