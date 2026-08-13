// Shared constants and pure helpers for artist_pay_requests — Phase 3 of the
// Artist / DJ Pay System plan (Request Pay + Review & Pay). Mirrors
// lib/booking-helpers.js: safe to import from client components, nothing
// here reaches for a service-role key.

import { formatMoney } from './studio-helpers';

export const PAY_REQUEST_STATUS_OPTIONS = [
  { value: 'pending_review', label: 'Pending review' },
  { value: 'approved', label: 'Approved — not yet paid' },
  { value: 'rejected', label: 'Rejected' },
];

export function payRequestStatusLabel(value) {
  return PAY_REQUEST_STATUS_OPTIONS.find((o) => o.value === value)?.label || value;
}

export { formatMoney };

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------
//
// There is deliberately no cron flipping bookings to 'completed' on a tight
// schedule (Vercel's cron frequency limit for this account's plan tier is
// unconfirmed, and the existing crons in vercel.json only run once daily —
// see the once-daily cleanup cron in this same phase for the cosmetic-only
// version of that). Eligibility is instead computed live, here, from
// slot_end + PAY_REQUEST_DELAY_MINUTES, and both the request-pay API route
// and the partner UI call this same function so they can never disagree.
export const PAY_REQUEST_DELAY_MINUTES = 15;

// Whether Request Pay may fire right now for a given booking's slot_end.
// Once eligible, it stays eligible indefinitely (per the confirmed plan
// decision: "Review-and-Pay button enables 15 min after DJ set ends, stays
// enabled indefinitely") — this never goes back to false once true.
export function isPayRequestEligible(slotEnd, now = new Date()) {
  const end = new Date(slotEnd);
  if (Number.isNaN(end.getTime())) return false;
  const eligibleAt = new Date(end.getTime() + PAY_REQUEST_DELAY_MINUTES * 60 * 1000);
  return now.getTime() >= eligibleAt.getTime();
}

// Minutes remaining until a booking becomes eligible (0 if already eligible
// or past). Used by the partner UI to show "Available in 12 min" instead of
// silently hiding the button with no explanation.
export function minutesUntilPayRequestEligible(slotEnd, now = new Date()) {
  const end = new Date(slotEnd);
  if (Number.isNaN(end.getTime())) return 0;
  const eligibleAt = new Date(end.getTime() + PAY_REQUEST_DELAY_MINUTES * 60 * 1000);
  return Math.max(0, Math.ceil((eligibleAt.getTime() - now.getTime()) / (60 * 1000)));
}

// What the partner-side button/badge should show for a booking row returned
// by public.partner_bookings(). Centralized so PayBookingCard doesn't
// reimplement this branching, and so the request-pay route can reuse the
// same "can they actually request right now" check server-side.
//
// Returns one of:
//   'no_partner'      — should not happen (this IS the partner's own row)
//   'not_yet'         — slot hasn't ended + 15min yet
//   'can_request'     — show the Request Pay button
//   'pending_review'  — awaiting admin action
//   'approved'        — cleared to pay, no money moved yet
//   'rejected'        — needs an admin reopen before they can request again
export function partnerBookingState(booking, now = new Date()) {
  if (booking?.pay_request_status === 'pending_review') return 'pending_review';
  if (booking?.pay_request_status === 'approved') return 'approved';
  if (booking?.pay_request_status === 'rejected') return 'rejected';
  if (booking?.status === 'cancelled') return 'cancelled';
  if (!isPayRequestEligible(booking?.slot_end, now)) return 'not_yet';
  return 'can_request';
}

// ---------------------------------------------------------------------------
// Cumulative pay / 1099 tracking
// ---------------------------------------------------------------------------

// Sums paid artist_pay_requests rows (status === 'paid' once Phase 4 wires
// Mercury — until then this always totals $0, which is expected and not a
// bug: there is nowhere in Phase 3 that can produce a 'paid' row) into a
// per-contact-per-calendar-year total. `requests` is the flat list from
// GET /api/admin/pay-requests; `year` filters by the request's created_at
// year (Austin time isn't relevant here — a calendar-year tax total is a UTC
// year boundary same as every other US 1099 system uses the payer's records).
export function cumulativePayByContact(requests, { year } = {}) {
  const totals = new Map();
  for (const r of requests || []) {
    if (r.status !== 'paid') continue;
    const rowYear = new Date(r.created_at).getUTCFullYear();
    if (year && rowYear !== year) continue;
    const key = r.contact_id;
    const existing = totals.get(key) || {
      contact_id: r.contact_id,
      contact_name: r.contact?.display_name || 'Unknown contact',
      total_cents: 0,
      paid_count: 0,
    };
    existing.total_cents += r.amount_cents || 0;
    existing.paid_count += 1;
    totals.set(key, existing);
  }
  return Array.from(totals.values()).sort((a, b) => b.total_cents - a.total_cents);
}

// Flagged explicitly as NOT a final number — Adam needs to confirm this with
// a CPA before Phase 4 does anything with it (e.g. auto-flagging a contact as
// 1099-required). $600/year is the common federal nonemployee-compensation
// threshold as of this writing, but state rules and any change to federal
// rules are out of scope for this constant to track on its own.
export const IRS_1099_THRESHOLD_CENTS_UNCONFIRMED = 60000;
