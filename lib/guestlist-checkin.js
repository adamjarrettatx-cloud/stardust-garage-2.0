// Pure helpers for the door check-in kiosk (/capacity/guest-list).
//
// Deliberately free of Supabase/React imports — same rule as
// lib/capacity-utils.js — so the name matching, masking and validation that
// decide whether a human gets waved in can be unit-tested under `node --test`
// and reused by both the API routes and the kiosk client.
//
// Lives in its own module rather than lib/guestlist-helpers.js because that file
// is shared with the partner portal and the admin allocation panel; the door is
// the only consumer of everything below.

// The two writes the door can make against an entry. Mirrors the dispatch table
// shape of CAPACITY_OPERATIONS so /api/capacity/guestlist/operation reads like
// its capacity sibling.
//
// `no_show` is logged as `entry_removed` because guestlist_audit_log.action is a
// DB CHECK constraint and 'no_show' is not one of its values — the audit
// `details.reason` carries the distinction. See the PR notes for the additive
// migration that would add a dedicated action.
export const DOOR_OPERATIONS = {
  check_in: { status: 'checked_in', auditAction: 'checked_in' },
  no_show: { status: 'no_show', auditAction: 'entry_removed' },
};

export function isDoorOperation(op) {
  return Object.prototype.hasOwnProperty.call(DOOR_OPERATIONS, op);
}

// Collapse the whitespace a name was typed with so "  Jane   Doe " and
// "Jane Doe" are the same person. Case is preserved — only compared folded.
export function normalizeGuestName(name) {
  return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
}

export function guestNamesMatch(a, b) {
  const left = normalizeGuestName(a).toLowerCase();
  return left !== '' && left === normalizeGuestName(b).toLowerCase();
}

// Escape a value that is about to be interpolated into a PostgREST `ilike`
// pattern. Without this, a guest legitimately named "A_B" or a stray % typed by
// a partner turns an exact-name lookup into a wildcard one and could surface a
// different guest's phone number for confirmation.
export function escapeLikePattern(value) {
  return String(value ?? '').replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// "phone ending in ****1234". Returns null when there is nothing useful to show,
// so callers render the email hint (or nothing) instead of a bare row of stars.
export function maskPhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 4) return null;
  return `****${digits.slice(-4)}`;
}

// "j****@gmail.com" — enough for staff to recognise their own guest without
// putting a full address on a screen facing a queue of strangers.
export function maskEmail(email) {
  const value = String(email ?? '').trim();
  const at = value.lastIndexOf('@');
  if (at < 1 || at === value.length - 1) return null;
  return `${value[0]}****${value.slice(at)}`;
}

// Shape a guest_profiles row for the wire. The door never receives a full phone
// number or email address: staff confirm identity from the masked hint, and
// nothing in this feature needs the real value.
export function maskGuestProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    full_name: profile.full_name,
    phone_hint: maskPhone(profile.phone),
    email_hint: maskEmail(profile.email),
    marketing_consent: Boolean(profile.marketing_consent),
    created_at: profile.created_at || null,
    first_seen_event: profile.first_seen_event
      ? { title: profile.first_seen_event.title, event_date: profile.first_seen_event.event_date }
      : null,
  };
}

// Classify a candidate list into the flow the kiosk should show:
//   'linked'   — the entry already points at a profile; confirm that one.
//   'single'   — exactly one name match; confirm with the masked phone.
//   'multiple' — common name; staff pick from the list or declare a new guest.
//   'none'     — first time we've met them; straight to the intake form.
export function matchModeFor(candidates, linkedProfile = null) {
  if (linkedProfile) return 'linked';
  const count = Array.isArray(candidates) ? candidates.length : 0;
  if (count === 0) return 'none';
  return count === 1 ? 'single' : 'multiple';
}

// ---------------------------------------------------------------------------
// Intake form (first-ever check-in)
// ---------------------------------------------------------------------------

// Phone/email/consent are all required: the whole point of guest_profiles is
// that a guest hands over contact details exactly once, ever, and the product
// requirement is that the door collects them before the guest goes in. Consent
// being mandatory is a product decision, not a technical one — it is enforced
// here so the client cannot skip the checkbox.
export function validateGuestIntake(input) {
  const phoneRaw = typeof input?.phone === 'string' ? input.phone.trim() : '';
  const emailRaw = typeof input?.email === 'string' ? input.email.trim() : '';
  const consent = input?.marketing_consent === true;

  const digits = phoneRaw.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) {
    return { valid: false, error: 'Enter a valid phone number (at least 10 digits).' };
  }
  // Deliberately permissive: a door is not the place to argue with an address
  // that has an unusual TLD. One @, something either side, no whitespace.
  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(emailRaw)) {
    return { valid: false, error: 'Enter a valid email address.' };
  }
  if (!consent) {
    return { valid: false, error: 'The guest has to agree to be contacted before check-in.' };
  }

  return {
    valid: true,
    data: {
      phone: phoneRaw,
      email: emailRaw.toLowerCase(),
      marketing_consent: true,
    },
  };
}

// ---------------------------------------------------------------------------
// Roster search
// ---------------------------------------------------------------------------

// The whole event roster is loaded once and filtered here on every keystroke:
// a door queue cannot wait on a round trip per character, and an event's list is
// a few hundred names at most.
//
// Every whitespace-separated token has to appear somewhere in the guest's name,
// so "jane d" finds "Jane Doe" and "doe jane" does too. Results are ordered
// most-likely-first (exact name, then name prefix, then word prefix, then
// anywhere), and within one relevance tier pending guests come before
// already-processed ones, because the person at the door has not walked in yet.
const STATUS_RANK = { pending: 0, checked_in: 1, no_show: 2 };

export function filterRoster(entries, query) {
  const list = Array.isArray(entries) ? entries : [];
  const needle = normalizeGuestName(query).toLowerCase();
  if (!needle) return [...list].sort(compareForDoor);

  const tokens = needle.split(' ');
  const scored = [];
  for (const entry of list) {
    const name = normalizeGuestName(entry?.guest_name).toLowerCase();
    if (!tokens.every((token) => name.includes(token))) continue;
    scored.push({ entry, score: nameScore(name, needle, tokens[0]) });
  }

  scored.sort((a, b) => a.score - b.score || compareForDoor(a.entry, b.entry));
  return scored.map((s) => s.entry);
}

function nameScore(name, needle, firstToken) {
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  if (name.split(' ').some((word) => word.startsWith(firstToken))) return 2;
  return 3;
}

function compareForDoor(a, b) {
  const rank = (STATUS_RANK[a?.status] ?? 3) - (STATUS_RANK[b?.status] ?? 3);
  if (rank !== 0) return rank;
  return normalizeGuestName(a?.guest_name).localeCompare(normalizeGuestName(b?.guest_name));
}

// Header counts for the kiosk: how much of tonight's list has walked in.
export function summarizeRoster(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return list.reduce(
    (acc, entry) => {
      acc.total += 1;
      if (entry?.status === 'checked_in') acc.checked_in += 1;
      else if (entry?.status === 'no_show') acc.no_show += 1;
      else acc.pending += 1;
      return acc;
    },
    { total: 0, pending: 0, checked_in: 0, no_show: 0 },
  );
}

// ---------------------------------------------------------------------------
// Event selection
// ---------------------------------------------------------------------------

// Which event the kiosk opens on, given the events that have a guest list and
// today's date in the venue's timezone (see getTodayInAustin).
//
// Yesterday counts, and beats anything upcoming: a door shift that runs past
// midnight is still working last night's list. Otherwise fall through to the
// soonest event ahead of us.
export function pickDefaultEventId(events, today) {
  const list = (Array.isArray(events) ? events : []).filter((e) => e?.id);
  if (list.length === 0) return null;

  const byDate = [...list].sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)));
  const todays = byDate.find((e) => e.event_date === today);
  if (todays) return todays.id;

  const past = byDate.filter((e) => String(e.event_date) < String(today));
  if (past.length > 0) return past[past.length - 1].id;

  return byDate[0].id;
}

// The oldest event_date the kiosk offers: yesterday, for the after-midnight
// case above. `today` is a YYYY-MM-DD string.
export function rosterWindowStart(today) {
  const parsed = new Date(`${today}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return today;
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}
