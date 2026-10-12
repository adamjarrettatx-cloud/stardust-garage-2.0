// One phone format for the whole platform.
//
// Stored: E.164 (+15125551234) for any valid US/NANP number. Twilio Verify,
// Trial Pass matching and the trial_passes unique index all depend on this
// exact string, so it is the only stored form. The database enforces it on
// every write (normalize_us_phone trigger, migration 20261012220000), so code
// paths that forget to normalize still land the canonical value.
//
// Displayed: +1 (512) 555-1234.
//
// Anything that is not a valid NANP number (international, wrong length, an
// area code or exchange starting with 0/1) is left exactly as entered rather
// than guessed into a wrong number.
const NANP = /^[2-9]\d{2}[2-9]\d{6}$/;

export function usPhoneDigits(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  return NANP.test(digits) ? digits : null;
}

export function normalizeStoredPhone(value) {
  const text = String(value ?? '').trim();
  if (!text) return text;
  const digits = usPhoneDigits(text);
  return digits ? `+1${digits}` : text;
}

export function formatPhone(value) {
  const text = String(value ?? '').trim();
  const digits = usPhoneDigits(text);
  return digits ? `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : text;
}

// tel: links dial the canonical number; unknown formats keep their digits.
export function phoneHref(value) {
  const stored = normalizeStoredPhone(value);
  return stored ? `tel:${stored.replace(/[^\d+]/g, '')}` : undefined;
}

// Lets "(512) 555", "512-555" or "5125551234" find +15125551234 in searches.
export function phoneMatchesQuery(value, query) {
  const q = String(query ?? '').replace(/\D/g, '');
  if (q.length < 3) return false;
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.includes(q) || (digits.length === 11 && digits[0] === '1' && digits.slice(1).includes(q));
}
