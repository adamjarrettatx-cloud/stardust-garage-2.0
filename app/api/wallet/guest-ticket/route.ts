import { NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseBearerToken } from '@/lib/request-auth';
import { rateLimit } from '@/lib/rate-limit';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (!isInternalTicketingEnabled()) return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404 });
  if (!parseBearerToken(request.headers.get('authorization')) &&
    request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  const user = await getRequestUser(request);
  if (!user || user.app_metadata?.station_account) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const limit = rateLimit({ key: `guest_ticket:${user.id}`, limit: 30, windowMs: 60_000 });
  if (!limit.ok) return NextResponse.json({ error: 'Too many requests. Please try again shortly.' },
    { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } });
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body || typeof body.ticket_id !== 'string' || !uuid.test(body.ticket_id) ||
    typeof body.reserved_for_guest !== 'boolean' || typeof body.expected_reserved_for_guest !== 'boolean') {
    return NextResponse.json({ error: 'Invalid ticket reservation.' }, { status: 400 });
  }
  try {
    const { data, error } = await createAdminClient().rpc('set_ticket_guest_reservation', {
      p_actor: user.id, p_ticket: body.ticket_id,
      p_reserved: body.reserved_for_guest, p_expected: body.expected_reserved_for_guest,
    });
    if (error) {
      if (error.code === 'P0002') return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
      if (error.code === 'P0001') return NextResponse.json({ error: 'This ticket is no longer available to change. Refresh your tickets.' }, { status: 409 });
      throw error;
    }
    if (data?.id !== body.ticket_id || data?.reserved_for_guest !== body.reserved_for_guest) throw new Error('Invalid result');
    return NextResponse.json({ ticket: data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Could not confirm the change. Refresh your tickets before sharing.' }, { status: 503 });
  }
}
