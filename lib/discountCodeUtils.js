// Utility functions for member discount code generation.

import crypto from 'crypto';
import { createDiscountCode } from '@/lib/tickettailor';

export const QUALIFYING_CATEGORIES = ['workshop', 'yoga', 'party'];

// Unambiguous alphanumeric set (no 0/O, 1/I) for the random suffix.
const RANDOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function initialsFromName(fullName) {
  const parts = (fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'MX';
  const letters = parts
    .map((p) => p[0])
    .join('')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase();
  return letters || 'MX';
}

function randomSuffix(length = 4) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += RANDOM_CHARS[bytes[i] % RANDOM_CHARS.length];
  }
  return out;
}

// Returns a code string like "SDG-AJ-K7M2".
export function generateMemberCode(fullName) {
  return `SDG-${initialsFromName(fullName)}-${randomSuffix(4)}`;
}

// Returns active members eligible for discount codes.
export async function getEligibleMembers(supabaseAdmin) {
  const { data, error } = await supabaseAdmin
    .from('member_profiles')
    .select('id, user_id, full_name, email, is_active, subscription_status')
    .eq('is_active', true)
    .eq('subscription_status', 'active');

  if (error) {
    throw new Error('Failed to load eligible members: ' + error.message);
  }
  return data || [];
}

// Parses 'YYYY-MM-DD' into a UTC Date to avoid local-timezone drift.
function parseEventDate(eventDate) {
  if (eventDate instanceof Date) return eventDate;
  const [y, m, d] = String(eventDate).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// Returns event_date minus 3 days as a Date object (UTC midnight).
export function getSendDate(eventDate) {
  const date = parseEventDate(eventDate);
  date.setUTCDate(date.getUTCDate() - 3);
  return date;
}

// Returns 'YYYY-MM-DD' string from a Date (UTC).
export function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

// Returns the send-scheduled date string (event_date - 3 days).
export function getSendDateString(eventDate) {
  return toDateString(getSendDate(eventDate));
}

// Returns the discount expiry as a unix timestamp (event_date + 1 day).
export function getExpiresUnix(eventDate) {
  const date = parseEventDate(eventDate);
  date.setUTCDate(date.getUTCDate() + 1);
  return Math.floor(date.getTime() / 1000);
}

// Generates a code string guaranteed not to collide with an existing row.
export async function generateUniqueMemberCode(supabaseAdmin, fullName) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateMemberCode(fullName);
    const { data, error } = await supabaseAdmin
      .from('member_discount_codes')
      .select('id')
      .eq('tt_discount_code', code)
      .maybeSingle();
    if (error) {
      throw new Error('Failed to check code uniqueness: ' + error.message);
    }
    if (!data) return code;
  }
  throw new Error('Could not generate a unique discount code after several attempts');
}

// Creates a TT discount code for one member and inserts a member_discount_codes
// row. Returns the inserted row, or null if a code already exists for this
// (event, member). Throws on TT/DB errors so callers can log-and-continue.
export async function createCodeForMember({
  supabaseAdmin,
  event,
  member,
  ticketTypeIds,
}) {
  // Skip if a code already exists for this (event, member).
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('member_discount_codes')
    .select('id')
    .eq('event_id', event.id)
    .eq('member_id', member.id)
    .maybeSingle();
  if (existingError) {
    throw new Error('Failed to check existing code: ' + existingError.message);
  }
  if (existing) return null;

  const codeString = await generateUniqueMemberCode(supabaseAdmin, member.full_name);
  const expiresUnix = getExpiresUnix(event.event_date);

  const { id: discountId, code } = await createDiscountCode({
    code: codeString,
    name: `Member 60% — ${event.title}`,
    ticketTypeIds,
    expiresUnix,
  });

  const row = {
    event_id: event.id,
    member_id: member.id,
    member_email: member.email,
    tt_discount_code: code,
    tt_discount_id: discountId,
    tt_event_series_id: event.tt_event_series_id,
    sent_at: null,
    send_scheduled_for: getSendDateString(event.event_date),
  };

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('member_discount_codes')
    .insert(row)
    .select()
    .single();
  if (insertError) {
    throw new Error('Failed to insert discount code row: ' + insertError.message);
  }
  return inserted;
}
