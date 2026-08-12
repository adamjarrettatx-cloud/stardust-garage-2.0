import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isContractorContact } from '@/lib/contact-helpers';
import { buildBookingPayload, loadEventBookings, auditBooking } from '@/lib/booking-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// Artist Lineup for one event — who's booked, what slot, what they're paid.
// Writes go through this route (not the client Supabase session) so the
// contractor-type check and the booking_audit_log row are server-side and
// unskippable, same reasoning as /api/admin/events/:id/guestlist.

// GET — every booking on this event, decorated with computed amount and the
// artist's partner-login state.
export async function GET(_request, { params }) {
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();
  const { bookings, error } = await loadEventBookings(admin, id);
  if (error) {
    console.error('[event.bookings.list]', error);
    return NextResponse.json({ error: 'Could not load the artist lineup' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, bookings });
}

// POST — add an artist to this event's lineup.
// Body: { contactId, slot_start, slot_end, pay_type, hourly_rate?, flat_amount? }
export async function POST(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad body' }, { status: 400 });
  }

  const contactId = body?.contactId;
  if (typeof contactId !== 'string' || !UUID.test(contactId)) {
    return NextResponse.json({ error: 'Select an artist to add to the lineup.' }, { status: 400 });
  }

  const { valid, error: validationError, data: payload } = buildBookingPayload(body);
  if (!valid) return NextResponse.json({ error: validationError }, { status: 400 });

  const admin = createAdminClient();

  const { data: event } = await admin.from('events').select('id').eq('id', id).maybeSingle();
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  const { data: contact } = await admin
    .from('contacts')
    .select('id, display_name, contact_type')
    .eq('id', contactId)
    .maybeSingle();
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  if (!isContractorContact(contact.contact_type)) {
    return NextResponse.json(
      { error: `${contact.display_name} isn't tagged as a DJ, artist, or performer contact.` },
      { status: 400 }
    );
  }

  const { data: created, error: insertError } = await admin
    .from('event_bookings')
    .insert({
      event_id: id,
      contact_id: contactId,
      created_by: user.id,
      updated_by: user.id,
      ...payload,
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('[event.bookings.create]', insertError);
    return NextResponse.json({ error: 'Could not add the artist to the lineup' }, { status: 500 });
  }

  await auditBooking({
    admin,
    action: 'booking_created',
    bookingId: created.id,
    actorId: user.id,
    actorEmail: user.email,
    request,
    details: {
      booking_id: created.id,
      event_id: id,
      contact_id: contactId,
      contact_name: contact.display_name,
      ...payload,
    },
  });

  const { bookings } = await loadEventBookings(admin, id);
  return NextResponse.json({ ok: true, bookings: bookings || null }, { status: 201 });
}
