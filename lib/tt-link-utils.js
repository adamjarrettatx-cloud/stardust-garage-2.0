// Pure helpers for the admin event-to-TicketTailor linking workflow. Split out
// from the route handler so the validation logic can be unit-tested without
// importing next/server or any Supabase/secret-bearing module.
//
// A TicketTailor event series ID looks like `ev_1234567` — an `ev_` prefix
// followed by digits. We normalize loosely (trim) and validate strictly so a
// typo never gets written to events.tt_event_series_id, while still allowing an
// explicit clear/unlink.

const TT_SERIES_ID = /^ev_[0-9]+$/;

// Normalize raw client input into a canonical value: a trimmed string, or null
// when the caller is clearing the link. `undefined`, null, and empty/whitespace
// strings all normalize to null (unlink). Returns `undefined` for inputs that
// aren't a string or null, so the caller can reject them as malformed.
export function normalizeSeriesId(raw) {
  if (raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

// Validate a normalized series ID. Returns { ok: true, value } where value is
// either a canonical `ev_...` string (link) or null (unlink), or
// { ok: false, error } with a human-readable reason.
//
// `value` is the output of normalizeSeriesId(): a non-empty string, null, or
// undefined (malformed type).
export function validateSeriesId(value) {
  if (value === null) return { ok: true, value: null };
  if (value === undefined) {
    return { ok: false, error: 'tt_event_series_id must be a string or null' };
  }
  if (value.length > 64) {
    return { ok: false, error: 'tt_event_series_id is too long' };
  }
  if (!TT_SERIES_ID.test(value)) {
    return { ok: false, error: 'tt_event_series_id must look like "ev_1234567"' };
  }
  return { ok: true, value };
}

// One-shot parse + validate from raw client input. Convenience wrapper over
// normalizeSeriesId + validateSeriesId used by the route.
export function parseSeriesIdInput(raw) {
  return validateSeriesId(normalizeSeriesId(raw));
}

// True when the requested change is an unlink (clearing the series).
export function isUnlink(value) {
  return value === null;
}
