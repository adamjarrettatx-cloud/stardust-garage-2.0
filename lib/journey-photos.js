// Shared helpers for the Membership Journey photo endpoint.
//
// Keys are `<kind>:<row id>`. Only ids travel from the browser; storage
// paths are always looked up server-side from these tables.

export const MAX_PHOTO_KEYS = 200;

// Row kind → source table and the photo columns it carries.
export const JOURNEY_PHOTO_SOURCES = {
  account: { table: 'free_accounts',   columns: 'id, profile_photo_path' },
  trial:   { table: 'trial_passes',    columns: 'id, profile_photo_path' },
  member:  { table: 'member_profiles', columns: 'id, profile_photo_path, photo_url' },
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// Returns { account: Set, trial: Set, member: Set }, or null when the input
// is not an array or asks for more than MAX_PHOTO_KEYS distinct rows.
// Malformed or unknown-kind keys are dropped silently.
export function parsePhotoKeys(input) {
  if (!Array.isArray(input)) return null;
  const byKind = { account: new Set(), trial: new Set(), member: new Set() };
  let total = 0;
  for (const key of input) {
    if (typeof key !== 'string') continue;
    const idx = key.indexOf(':');
    if (idx < 0) continue;
    const kind = key.slice(0, idx);
    const id = key.slice(idx + 1);
    if (!byKind[kind] || !ID_PATTERN.test(id) || byKind[kind].has(id)) continue;
    byKind[kind].add(id);
    total += 1;
    if (total > MAX_PHOTO_KEYS) return null;
  }
  return byKind;
}
