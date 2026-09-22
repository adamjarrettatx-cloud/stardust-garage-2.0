// Pure matching/validation helpers, shared by server code and tests.
export const SUBJECT_KINDS = Object.freeze({
  trial_pass: 'trial_passes', member: 'member_profiles',
  guest: 'guest_profiles', guestlist: 'event_guestlist_entries', ticket: 'tickets',
});
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function normalizeName(value = '') {
  return String(value).normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
export function contactKeys({ full_name, email, phone, aliases = [] }) {
  const keys = [full_name, ...aliases].map(normalizeName).filter(Boolean).map(n => `name:${n}`);
  if (email?.trim()) keys.push(`email:${email.trim().toLowerCase()}`);
  let digits = (phone || '').replace(/\D/g, '');
  if (digits.length === 10) digits = `1${digits}`;
  if (digits.length >= 7) keys.push(`phone:${digits}`);
  return [...new Set(keys)];
}
export function isActiveRestriction(row, now = Date.now()) {
  return !row.lifted_at && (!row.expires_at || Date.parse(row.expires_at) > now);
}
export function matchLevel(restriction, identity) {
  return restriction.identity_keys.some(key => identity.identity_keys.includes(key)) ? 'confirmed' : 'possible';
}
export function validateRestriction(body, now = Date.now()) {
  if (typeof body.full_name !== 'string' || !body.full_name.trim() || body.full_name.length > 160) {
    throw new Error('A name of up to 160 characters is required.');
  }
  if (!['banned', 'temporary', 'review'].includes(body.kind)) throw new Error('Choose a restriction type.');
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 2000) {
    throw new Error('A specific reason is required (up to 2,000 characters).');
  }
  if (body.kind === 'temporary' && (!body.expires_at || !Number.isFinite(Date.parse(body.expires_at)) || Date.parse(body.expires_at) <= now)) {
    throw new Error('Temporary restrictions need a future expiration.');
  }
  for (const key of ['email', 'phone', 'identifying_details']) {
    if (body[key] != null && (typeof body[key] !== 'string' || body[key].length > (key === 'identifying_details' ? 2000 : 254))) {
      throw new Error(`Invalid ${key.replaceAll('_', ' ')}.`);
    }
  }
  if (body.aliases != null && (!Array.isArray(body.aliases) || body.aliases.length > 10 ||
      body.aliases.some(n => typeof n !== 'string' || n.length > 160))) throw new Error('Use up to 10 aliases.');
}
