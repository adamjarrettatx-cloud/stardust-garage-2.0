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

// ---- Similar-name matching -------------------------------------------------
// A banned guest can come back under a slightly different name ("Jade
// Gonzalez" -> "Jada Maria Gonzalez"). Similar names are ALWAYS "possible"
// matches: they hold entry until staff compare photos and either link the
// account (hard block) or record a commented override. They never auto-confirm.
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
// First names: same, one typo (4+ letters), or a 3+ letter shortening
// (Chris/Christopher, Jada/Jadah).
export function firstNameClose(a, b) {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  if (min >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  return min >= 4 && editDistance(a, b) <= 1;
}
// Last names: same, or one typo when 5+ letters (Gonzalez/Gonzales).
export function lastNameClose(a, b) {
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 5 && editDistance(a, b) <= 1;
}
// Middle names and extra/hyphenated surnames are ignored: the banned last name
// may appear anywhere after the guest's first name, or vice versa.
export function namesSimilar(bannedName, guestName) {
  const b = normalizeName(bannedName).split(' ').filter(Boolean);
  const g = normalizeName(guestName).split(' ').filter(Boolean);
  if (b.length < 2 || g.length < 2) return b.length > 0 && b.join(' ') === g.join(' ');
  if (!firstNameClose(b[0], g[0])) return false;
  return g.slice(1).some(t => lastNameClose(b[b.length - 1], t))
    || b.slice(1).some(t => lastNameClose(g[g.length - 1], t));
}
const namesOf = keys => keys.filter(k => k.startsWith('name:')).map(k => k.slice(5));
export function similarNameMatch(restriction, identity) {
  for (const banned of namesOf(restriction.match_keys || [])) {
    for (const guest of namesOf(identity.match_keys || [])) {
      if (namesSimilar(banned, guest)) return { banned, guest };
    }
  }
  return null;
}
// Plain-English explanation shown to door staff.
export function matchReason(restriction, identity) {
  if (matchLevel(restriction, identity) === 'confirmed') return 'This account is linked to the ban.';
  const shared = (restriction.match_keys || []).filter(k => (identity.match_keys || []).includes(k));
  if (shared.some(k => k.startsWith('email:'))) return 'Same email as the banned list.';
  if (shared.some(k => k.startsWith('phone:'))) return 'Same phone number as the banned list.';
  if (shared.some(k => k.startsWith('name:'))) return 'Same name as the banned list.';
  const similar = similarNameMatch(restriction, identity);
  return similar ? `Name is similar to the banned list (“${identity.full_name || similar.guest}” vs “${restriction.full_name}”).` : 'Possible match.';
}
export const RESTRICTION_PHOTO_BUCKET = 'restriction-photos';
export const RESTRICTION_PHOTO_TYPES = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });
export const MAX_RESTRICTION_PHOTO_BYTES = 10 * 1024 * 1024;
export function sniffImageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}
export function validateRestrictionEdit(body) {
  if (body.full_name != null && (typeof body.full_name !== 'string' || !body.full_name.trim() || body.full_name.length > 160)) {
    throw new Error('A name of up to 160 characters is required.');
  }
  for (const key of ['email', 'phone', 'identifying_details', 'comment']) {
    if (body[key] != null && (typeof body[key] !== 'string' || body[key].length > (['identifying_details', 'comment'].includes(key) ? 2000 : 254))) {
      throw new Error(`Invalid ${key.replaceAll('_', ' ')}.`);
    }
  }
  if (body.aliases != null && (!Array.isArray(body.aliases) || body.aliases.length > 10 ||
      body.aliases.some(n => typeof n !== 'string' || n.length > 160))) throw new Error('Use up to 10 aliases.');
}
