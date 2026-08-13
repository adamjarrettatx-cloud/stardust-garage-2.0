// Shared constants and helpers for event_bookings — the Artist Lineup: which
// artist is playing an event, in what slot, and what they're owed for it.
// Phase 2 of the Artist / DJ Pay System plan. Mirrors lib/guestlist-helpers.js:
// safe to import from client components (nothing here reaches for a
// service-role key), auditBooking() takes the admin client as an argument
// (the caller is a gated route handler).

import { dollarsToCents } from './tt-event-create';
import { formatMoney } from './studio-helpers';

export const PAY_TYPE_OPTIONS = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'flat', label: 'Flat rate' },
];

// Mirrors the event_bookings.status check constraint. Phase 2 can only ever
// produce 'scheduled' and 'cancelled' — the rest are here so the UI already
// knows how to label a row once Phase 3/4 start setting them, without another
// round of "add the label for the new status" edits later.
export const BOOKING_STATUS_OPTIONS = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed — awaiting request' },
  { value: 'pay_requested', label: 'Pay requested' },
  { value: 'approved', label: 'Approved — not yet paid' },
  { value: 'in_review', label: 'In review' },
  { value: 'paid', label: 'Paid' },
  { value: 'rejected', label: 'Rejected — needs reopen' },
  { value: 'cancelled', label: 'Cancelled' },
];

// Mirrors the booking_audit_log.action check constraint. Only what Phase 2
// can actually write — Phase 3 will extend both this list and the DB
// constraint together when the Request Pay / Review & Pay actions ship.
export const BOOKING_AUDIT_ACTIONS = ['booking_created', 'booking_updated', 'booking_cancelled'];

export function payTypeLabel(value) {
  return PAY_TYPE_OPTIONS.find((o) => o.value === value)?.label || value;
}

export function bookingStatusLabel(value) {
  return BOOKING_STATUS_OPTIONS.find((o) => o.value === value)?.label || value;
}

// True once a pay request exists or has been resolved for this booking. Once
// that's happened, editing or removing the booking out from under it would
// leave the request pointing at a moved target — block both in the route,
// and grey the edit/delete controls out in the panel for the same reason.
export function bookingPayInProgress(status) {
  return ['pay_requested', 'approved', 'in_review', 'paid'].includes(status);
}

export { formatMoney };

// ---------------------------------------------------------------------------
// Time + pay maths
// ---------------------------------------------------------------------------

// Hours between two ISO timestamps, as a float (so a 90-minute set is 1.5,
// not rounded to 1 or 2). Callers multiply this by hourly_rate_cents.
export function hoursBetweenTimestamps(slotStart, slotEnd) {
  const start = new Date(slotStart);
  const end = new Date(slotEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
}

// Total pay for a booking, in cents. Rounds to the nearest cent so an odd
// hourly rate over a fractional number of hours doesn't produce a
// sub-cent amount. Returns null if the slot times don't parse.
export function computeBookingAmountCents(booking) {
  if (booking?.pay_type === 'flat') {
    return Number.isFinite(booking?.flat_amount_cents) ? booking.flat_amount_cents : null;
  }
  const hours = hoursBetweenTimestamps(booking?.slot_start, booking?.slot_end);
  if (hours === null || !Number.isFinite(booking?.hourly_rate_cents)) return null;
  return Math.round(booking.hourly_rate_cents * hours);
}

const TIMEZONE = 'America/Chicago';

// "Aug 15, 10:00 PM – 12:00 AM" — Austin time, matching how the rest of
// /bananas reads event times (see lib/studio-helpers.js's TIMEZONE constant).
// Drops the date off the end when both slot times fall on the same Austin day.
export function formatSlotRange(slotStart, slotEnd) {
  const start = new Date(slotStart);
  const end = new Date(slotEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '—';

  const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, month: 'short', day: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
  });

  const startDay = dateFmt.format(start);
  const endDay = dateFmt.format(end);
  const startLabel = `${startDay}, ${timeFmt.format(start)}`;
  const endLabel = startDay === endDay ? timeFmt.format(end) : `${endDay}, ${timeFmt.format(end)}`;
  return `${startLabel} – ${endLabel}`;
}

// Converts an ISO timestamp to the value a <input type="datetime-local">
// expects ("YYYY-MM-DDTHH:mm"), rendered in the browser's local timezone —
// matches how the browser will interpret it back on submit.
export function toDatetimeLocalValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Compact "$150 (3h @ $50/hr)" / "$300 flat" string for the admin panel.
export function formatBookingAmount(booking) {
  const totalCents = computeBookingAmountCents(booking);
  if (totalCents === null) return '—';
  if (booking.pay_type === 'flat') return `${formatMoney(totalCents)} flat`;
  const hours = hoursBetweenTimestamps(booking.slot_start, booking.slot_end);
  const hoursLabel = Number.isInteger(hours) ? hours : hours.toFixed(1);
  return `${formatMoney(totalCents)} (${hoursLabel}h @ ${formatMoney(booking.hourly_rate_cents)}/hr)`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Body: { slot_start, slot_end (ISO datetime strings), pay_type,
//         hourly_rate (dollars, string or number), flat_amount (dollars) }
// Returns the DB-shaped payload (rate/amount already converted to cents).
export function buildBookingPayload(body) {
  const slotStart = String(body?.slot_start ?? '').trim();
  const slotEnd = String(body?.slot_end ?? '').trim();
  if (!slotStart || !slotEnd) {
    return { valid: false, error: 'Pick a start and end time for this slot.' };
  }

  const startDate = new Date(slotStart);
  const endDate = new Date(slotEnd);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { valid: false, error: 'Slot start/end must be valid dates.' };
  }
  if (endDate <= startDate) {
    return { valid: false, error: 'Slot end must be after slot start.' };
  }

  const payType = body?.pay_type;
  if (!PAY_TYPE_OPTIONS.some((o) => o.value === payType)) {
    return { valid: false, error: 'Pick hourly or flat rate.' };
  }

  const payload = {
    slot_start: startDate.toISOString(),
    slot_end: endDate.toISOString(),
    pay_type: payType,
    hourly_rate_cents: null,
    flat_amount_cents: null,
  };

  if (payType === 'hourly') {
    const cents = dollarsToCents(body?.hourly_rate);
    if (cents === null || Number.isNaN(cents) || cents <= 0) {
      return { valid: false, error: 'Enter an hourly rate greater than $0.' };
    }
    payload.hourly_rate_cents = cents;
  } else {
    const cents = dollarsToCents(body?.flat_amount);
    if (cents === null || Number.isNaN(cents) || cents <= 0) {
      return { valid: false, error: 'Enter a flat amount greater than $0.' };
    }
    payload.flat_amount_cents = cents;
  }

  return { valid: true, data: payload };
}

// ---------------------------------------------------------------------------
// Loading + decorating bookings for the admin panel
// ---------------------------------------------------------------------------

const BOOKING_SELECT = `
  id, event_id, contact_id, slot_start, slot_end, pay_type,
  hourly_rate_cents, flat_amount_cents, status, created_at, updated_at,
  contact:contact_id ( display_name, company, contact_type )
`;

// Every booking on an event, soonest slot first, decorated with whether the
// artist has an active partner login (same reason GuestListPanel shows this —
// an admin should know a "Request Pay" button has nobody to press it yet).
// Takes the service-role client because the caller is a gated route handler.
export async function loadEventBookings(admin, eventId) {
  const { data: bookings, error } = await admin
    .from('event_bookings')
    .select(BOOKING_SELECT)
    .eq('event_id', eventId)
    .order('slot_start', { ascending: true });

  if (error) return { error };

  const contactIds = (bookings || []).map((b) => b.contact_id);
  let partnerProfiles = [];
  if (contactIds.length) {
    const { data } = await admin
      .from('partner_profiles')
      .select('contact_id, is_active, invited_at, activated_at')
      .in('contact_id', contactIds);
    partnerProfiles = data || [];
  }
  const byContact = new Map((partnerProfiles || []).map((p) => [p.contact_id, p]));

  return {
    bookings: (bookings || []).map((b) => ({
      ...b,
      amount_cents: computeBookingAmountCents(b),
      partner: byContact.get(b.contact_id)
        ? {
            is_active: Boolean(byContact.get(b.contact_id).is_active),
            invited_at: byContact.get(b.contact_id).invited_at || null,
            activated_at: byContact.get(b.contact_id).activated_at || null,
          }
        : null,
    })),
  };
}

// Insert a booking audit row. Never throws — auditing must not break the
// request. Mirrors auditGuestlist() in lib/guestlist-helpers.js, including
// pulling the real ip/user-agent off the request so they can't be spoofed.
export async function auditBooking({ admin, action, bookingId = null, actorId, actorEmail, request, details = null }) {
  try {
    await admin.from('booking_audit_log').insert({
      action,
      booking_id: bookingId,
      actor_id: actorId,
      actor_email: actorEmail,
      ip_address: request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      user_agent: request?.headers.get('user-agent') || null,
      details,
    });
  } catch (err) {
    console.error('[auditBooking] failed to insert audit row', err);
  }
}
