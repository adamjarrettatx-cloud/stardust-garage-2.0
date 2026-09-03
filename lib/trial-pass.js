// Trial SDG Pass — the rules, in one place.
//
// A guest scans a printed QR code, gives three fields, and walks away with a
// pass that is live for 30 days. Three different callers need to agree on what
// that means: the public intake route, the door lookup, and the nightly
// reminder cron. When "is this pass still good?" is re-implemented in three
// places it eventually gets answered three different ways, and the version
// that disagrees is the one facing a queue of strangers at 11pm.
//
// So everything below is pure (plus node:crypto, same as
// lib/capacity-device-utils.js) and unit tested under `node --test` — no
// Supabase, no React, no fetch. SERVER ONLY: importing this into a client
// component would ship the token scheme to the browser.
import { randomBytes, createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

// How long a pass is live for after activation. The 30-day membership window
// starts on first door check-in, not at signup, so a guest who signs up on a
// Monday but does not come until three Fridays later still gets a full 30
// days of trial.
export const TRIAL_WINDOW_DAYS = 30;

// The outer limit: a signed-up pass that is never activated dies at day 60.
// Long enough that a guest who signs up on a slow week can still come out
// the following month; short enough that the QR list does not grow forever.
export const TRIAL_SIGNUP_WINDOW_DAYS = 60;

// The paid save: staff at the door can add 7 days for $40 when someone turns
// up on a pass that has just run out. The price lives here so the door screen,
// the email and any future receipt all quote the same number.
export const TRIAL_EXTENSION_DAYS = 7;
export const TRIAL_EXTENSION_PRICE_USD = 40;

// Nudge cadence and how many nudges a 30-day window gets. Days 6, 12, 18, 24 —
// day 30 is the expiry notice, not a nudge, so it is not counted here.
export const REMINDER_INTERVAL_DAYS = 6;
export const MAX_REMINDERS = 4;

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export function addDays(from, days) {
  const base = toDate(from);
  if (!base) return null;
  return new Date(base.getTime() + days * DAY_MS);
}

// Has the guest ever checked in? activated_at is null until their first
// allowed door scan, and set exactly once at that moment. This distinguishes
// "pass exists but the 30-day clock hasn't started" from "pass exists and is
// counting down".
export function isActivated(pass) {
  return Boolean(toDate(pass?.activated_at));
}

// When does this pass actually stop working?
//
// Two clocks:
//   Pre-activation: the outer signup_expires_at, i.e. sign-up + 60 days.
//                   If the guest never activates by then, the QR dies.
//   Post-activation: max(expires_at, extended_until). expires_at is set to
//                    activated_at + 30 days on the first allowed check-in;
//                    extended_until only exists if staff sold the paid
//                    7-day extension.
//
// Taking the later of expires_at and extended_until means a badly-timed
// extension (granted a day after expiry, say) can only ever help the guest.
export function effectiveExpiry(pass) {
  if (!pass) return null;
  if (!isActivated(pass)) {
    return toDate(pass.signup_expires_at);
  }
  const expires = toDate(pass.expires_at);
  const extended = toDate(pass.extended_until);
  if (!expires) return extended;
  if (!extended) return expires;
  return extended > expires ? extended : expires;
}

// Live iff the window is open AND the status has not moved on. 'applied' and
// 'converted' deliberately stay usable: someone who submitted an application
// on day 3 should not be turned away on day 4 for having done the thing we
// asked them to do.
export function isPassLive(pass, now = new Date()) {
  if (!pass || pass.status === 'expired') return false;
  const expiry = effectiveExpiry(pass);
  const at = toDate(now);
  if (!expiry || !at) return false;
  return at.getTime() < expiry.getTime();
}

// Whole days left, floored, never negative. What the pass page and the
// reminder emails show; 0 means "expires today". Callers wanting to
// distinguish "unactivated, N days until the sign-up window closes" from
// "activated, N days on the 30-day clock" should use passWindowState().
export function daysRemaining(pass, now = new Date()) {
  const expiry = effectiveExpiry(pass);
  const at = toDate(now);
  if (!expiry || !at) return 0;
  return Math.max(0, Math.floor((expiry.getTime() - at.getTime()) / DAY_MS));
}

// The unified answer to "what should the pass page and dashboard show?".
// Returns:
//   { phase: 'unactivated', daysToSignupExpiry }
//   { phase: 'activated',   daysToExpiry }
//   { phase: 'expired',     expiredAt }
//
// Callers use `phase` to pick copy: unactivated passes read "Your 30 days
// start on your first visit", activated passes read "12 days left", expired
// passes read "Your trial ended on X".
export function passWindowState(pass, now = new Date()) {
  if (!pass) return { phase: 'expired', expiredAt: null };
  const at = toDate(now);
  if (!at) return { phase: 'expired', expiredAt: null };

  if (!isActivated(pass)) {
    const outer = toDate(pass.signup_expires_at);
    if (!outer || at.getTime() >= outer.getTime()) {
      return { phase: 'expired', expiredAt: outer };
    }
    return {
      phase: 'unactivated',
      daysToSignupExpiry: Math.max(0, Math.floor((outer.getTime() - at.getTime()) / DAY_MS)),
    };
  }

  const expiry = effectiveExpiry(pass);
  if (!expiry || at.getTime() >= expiry.getTime()) {
    return { phase: 'expired', expiredAt: expiry };
  }
  return {
    phase: 'activated',
    daysToExpiry: Math.max(0, Math.floor((expiry.getTime() - at.getTime()) / DAY_MS)),
  };
}

// Days elapsed since issue. Reminder cron uses this for unactivated passes
// (send "come use your pass" nudges at day 14, 30, 45 from signup).
export function daysSinceIssued(pass, now = new Date()) {
  const issued = toDate(pass?.issued_at) || toDate(pass?.created_at);
  const at = toDate(now);
  if (!issued || !at) return 0;
  return Math.max(0, Math.floor((at.getTime() - issued.getTime()) / DAY_MS));
}

// Days elapsed since activation. Reminder cron uses this for activated
// passes (nudges at day 6, 12, 18, 24). Returns 0 for unactivated passes.
export function daysSinceActivated(pass, now = new Date()) {
  const activated = toDate(pass?.activated_at);
  const at = toDate(now);
  if (!activated || !at) return 0;
  return Math.max(0, Math.floor((at.getTime() - activated.getTime()) / DAY_MS));
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

// 32 bytes = 256 bits, rendered base64url (43 chars). The pass URL that gets
// encoded into the QR is therefore ~66 characters — comfortably inside the
// ~134-char byte-mode ceiling of lib/qr-code.js at version 6, which is the
// largest version that encoder emits.
export const PASS_TOKEN_BYTES = 32;

export function generatePassToken() {
  return randomBytes(PASS_TOKEN_BYTES).toString('base64url');
}

// SHA-256 hex for at-rest storage. The raw token is never persisted: it exists
// in the success-screen URL and the guest's email, and the database holds only
// this. Salt-free is correct for a 256-bit random value — there is no
// dictionary to defend against, and lookups have to be deterministic.
export function hashPassToken(rawToken) {
  if (typeof rawToken !== 'string' || rawToken.length === 0) return null;
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

// base64url only. Rejecting anything else before it reaches the database keeps
// a scanner that read a smudged code (or a bored guest editing the URL) from
// turning into a query.
export function isWellFormedPassToken(rawToken) {
  return typeof rawToken === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(rawToken);
}

// The URL behind the QR code. It is a real web page, not an opaque payload, so
// a guest whose Wallet install failed can still open their own pass, and any
// phone camera can read it without a special app.
export function buildPassUrl(siteUrl, rawToken) {
  if (!rawToken) return null;
  const base = String(siteUrl || '').replace(/\/+$/, '');
  return `${base}/pass/${encodeURIComponent(rawToken)}`;
}

// The inverse: given whatever a QR scanner just decoded, pull the pass token
// out. Two shapes exist in the wild:
//
//   1. The full pass URL that buildPassUrl() produced, e.g.
//      "https://www.sdgatx.com/pass/ABC...xyz"  — what every real pass QR
//      carries.
//   2. The bare token itself, e.g. "ABC...xyz" — what a QR-generator app or a
//      staff hand-typed test would produce.
//
// Any other input (a URL that is not a /pass/ URL, a QR pointing at Instagram,
// gibberish) returns null so the scanner surfaces "not a pass" instead of
// POSTing a random string to the scan endpoint. This is the *cheap* filter;
// the server still calls isWellFormedPassToken() and looks the token up.
export function extractPassTokenFromScan(scanned) {
  if (typeof scanned !== 'string') return null;
  const trimmed = scanned.trim();
  if (!trimmed) return null;

  // Try URL first: only accept the /pass/<token> shape, on any host. The host
  // could be www.sdgatx.com in prod, a preview deploy, or localhost in dev,
  // and staff should never have to think about that. The token has to be the
  // *last* path segment — no trailing slashes, no subpaths — to keep this from
  // matching a URL that happens to include "/pass/" somewhere in the middle.
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const match = url.pathname.match(/^\/pass\/([^/]+)\/?$/);
      if (!match) return null;
      const decoded = decodeURIComponent(match[1]);
      return isWellFormedPassToken(decoded) ? decoded : null;
    } catch {
      return null;
    }
  }

  // Bare token path. Same well-formedness rule as the server enforces, so a
  // QR that decoded to "HELLO" or a full sentence never reaches the network.
  return isWellFormedPassToken(trimmed) ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Intake validation
// ---------------------------------------------------------------------------

// Full legal name, mobile phone, email — all three required, matching the
// three-question form. Rules are intentionally close to
// validateGuestIntake() in lib/guestlist-checkin.js so a guest who is entered
// at the door and one who scans the QR are held to the same standard:
// permissive about format, strict about presence.
//
// The one difference is the name. The door already has a name from the guest
// list; this form is where it is first typed, and "full legal name" is what
// TABC-relevant records need, so a single word gets a nudge rather than a hard
// stop — someone genuinely mononymous should not be locked out of a pass.
export function validateTrialPassIntake(input) {
  const nameRaw = typeof input?.fullName === 'string' ? input.fullName.trim().replace(/\s+/g, ' ') : '';
  const phoneRaw = typeof input?.phone === 'string' ? input.phone.trim() : '';
  const emailRaw = typeof input?.email === 'string' ? input.email.trim() : '';

  if (nameRaw.length < 2 || !/[A-Za-z]/.test(nameRaw)) {
    return { valid: false, field: 'fullName', error: 'Enter your full legal name.' };
  }
  if (nameRaw.length > 120) {
    return { valid: false, field: 'fullName', error: 'That name is too long.' };
  }

  const digits = phoneRaw.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) {
    return { valid: false, field: 'phone', error: 'Enter a valid mobile number (at least 10 digits).' };
  }

  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(emailRaw) || emailRaw.length > 254) {
    return { valid: false, field: 'email', error: 'Enter a valid email address.' };
  }

  const email = emailRaw.toLowerCase();
  return {
    valid: true,
    data: {
      full_name: nameRaw,
      phone: normalizePhone(phoneRaw),
      email,
      email_canonical: canonicalizeEmail(email),
    },
  };
}

// The email we actually dedupe on. Mirrors the SQL expression on the
// email_canonical generated column in the 20260825 migration exactly — if
// these two ever diverge the create route will read a canonical value that
// does not match the one Postgres stored, and the unique-index protection
// stops working. Keep them in sync.
//
// Rules:
//   - lowercase
//   - strip `+tag` from the local part
//   - on gmail.com or googlemail.com, strip dots from local and normalize
//     the host to gmail.com (Gmail treats these as identical)
//
// Other carriers get the plus-tag treatment only. Yahoo aliases, iCloud +tags
// etc. can be added if/when they show up as an abuse vector — the migration
// note explains how to extend the SQL expression alongside this function.
export function canonicalizeEmail(input) {
  const email = String(input ?? '').trim().toLowerCase();
  if (!email) return '';
  const at = email.indexOf('@');
  if (at < 0) return email;
  let local = email.slice(0, at);
  let host = email.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  if (host === 'gmail.com' || host === 'googlemail.com') {
    local = local.replace(/\./g, '');
    host = 'gmail.com';
  }
  return `${local}@${host}`;
}

// E.164 where we can be confident, original digits where we cannot. A US
// 10-digit number gets +1; an 11-digit number starting with 1 is the same
// number typed with the country code; anything else is left as entered digits
// with a + so an international guest's number is not mangled into a wrong one.
export function normalizePhone(input) {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 0) return '';
  return `+${digits}`;
}

// ---------------------------------------------------------------------------
// Door decision
// ---------------------------------------------------------------------------

// The kiosk shows one of these and nothing else. Staff at a door do not read
// prose: they need a colour, a headline, and — when the answer is no — the one
// action that fixes it.
export const DOOR_RESULTS = {
  allowed: 'allowed',
  denied_expired: 'denied_expired',
  denied_ineligible_event: 'denied_ineligible_event',
  denied_duplicate: 'denied_duplicate',
};

// Which events a trial pass gets in to: Friday, Saturday or Sunday, and tagged
// as a music event. Same rule as the Party Pass, because the trial is meant to
// feel like a taste of it. Day-of-week is computed from the event's own
// event_date (a plain YYYY-MM-DD in venue-local terms), never from the
// server's clock — a scan at 1am Saturday belongs to Friday's event.
export const TRIAL_ELIGIBLE_WEEKDAYS = [5, 6, 0]; // Fri, Sat, Sun
export const TRIAL_ELIGIBLE_CATEGORY_PATTERN = /music/i;

export function eventWeekday(eventDate) {
  if (typeof eventDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return null;
  // Noon UTC: far enough from either midnight that no timezone shifts the day.
  const parsed = new Date(`${eventDate}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCDay();
}

export function isEventTrialEligible(event) {
  if (!event) return false;
  const weekday = eventWeekday(event.event_date);
  if (weekday === null || !TRIAL_ELIGIBLE_WEEKDAYS.includes(weekday)) return false;
  return TRIAL_ELIGIBLE_CATEGORY_PATTERN.test(String(event.category ?? ''));
}

// The whole door decision, as one pure function, so it can be tested without a
// database and cannot drift from what the reminder cron believes.
//
// `alreadyCheckedIn` is passed in rather than looked up here: the caller knows,
// and keeping this synchronous is what makes it testable.
export function evaluateDoorScan({ pass, event, alreadyCheckedIn = false, now = new Date() } = {}) {
  if (!pass) {
    return { result: null, allowed: false, reason: 'Pass not found.' };
  }

  if (!isPassLive(pass, now)) {
    const expiry = effectiveExpiry(pass);
    const staffAction = isActivated(pass)
      ? `Offer the $${TRIAL_EXTENSION_PRICE_USD} ${TRIAL_EXTENSION_DAYS}-day extension if they bought a ticket.`
      : 'This pass was never used and has passed its 60-day activation window. Ask them to scan the QR again for a fresh one.';
    return {
      result: DOOR_RESULTS.denied_expired,
      allowed: false,
      reason: isActivated(pass)
        ? 'Trial pass expired.'
        : 'Trial pass was never activated in time.',
      staffAction,
      expiredOn: expiry ? expiry.toISOString() : null,
    };
  }

  if (event && !isEventTrialEligible(event)) {
    return {
      result: DOOR_RESULTS.denied_ineligible_event,
      allowed: false,
      reason: 'Tonight is not a trial-pass event.',
      staffAction: 'Trial passes cover Friday-Sunday music events only.',
    };
  }

  if (alreadyCheckedIn) {
    return {
      result: DOOR_RESULTS.denied_duplicate,
      allowed: false,
      reason: 'This pass was already scanned tonight.',
      staffAction: 'Someone may be re-using a pass that is already inside.',
    };
  }

  return {
    result: DOOR_RESULTS.allowed,
    allowed: true,
    reason: 'Trial pass valid.',
    daysRemaining: daysRemaining(pass, now),
  };
}

// ---------------------------------------------------------------------------
// Reminder schedule
// ---------------------------------------------------------------------------

// Is a nudge due for this pass today, and if so which one? The rules split
// on activation:
//
//   Activated passes: same 6/12/18/24 cadence from activated_at, driving the
//     "you've used your pass, now apply for membership" sequence.
//
//   Unactivated passes: a lighter sequence from issued_at that says "come
//     use your pass" — day 14, 30, 45. We cap at 3 so we don't spam someone
//     who signed up impulsively and doesn't want us in their inbox.
//
// Driven off (days elapsed, reminders already sent) rather than "has it been
// N days since the last email", so a cron outage cannot silently skip a
// guest's whole sequence: whenever it next runs, the pass is behind schedule
// and gets exactly one catch-up nudge, not four at once.
//
// Returns { due, sequence, daysLeft, kind } where `kind` is 'activation_nudge'
// or 'application_nudge' so the mailer picks the right template. The
// `sequence` written to trial_pass_emails is what makes a repeated cron run a
// no-op rather than a second email.
export const UNACTIVATED_REMINDER_DAYS = [14, 30, 45];
export const MAX_UNACTIVATED_REMINDERS = UNACTIVATED_REMINDER_DAYS.length;

export function reminderDueFor(pass, now = new Date()) {
  const none = { due: false, sequence: null, daysLeft: 0, kind: null };
  if (!pass) return none;

  // Reminders exist to get someone to apply. Once they have, the sequence is
  // over — including for a pass that later converts.
  if (pass.applied_at || pass.converted_at) return none;
  if (pass.status === 'applied' || pass.status === 'converted') return none;
  if (!isPassLive(pass, now)) return none;

  const sent = Number.isInteger(pass.reminders_sent) ? pass.reminders_sent : 0;

  if (isActivated(pass)) {
    if (sent >= MAX_REMINDERS) return none;
    const elapsed = daysSinceActivated(pass, now);
    const earned = Math.min(MAX_REMINDERS, Math.floor(elapsed / REMINDER_INTERVAL_DAYS));
    if (earned <= sent) return none;
    return {
      due: true,
      sequence: sent + 1,
      daysLeft: daysRemaining(pass, now),
      kind: 'application_nudge',
    };
  }

  // Unactivated: use a separate ladder, capped at MAX_UNACTIVATED_REMINDERS.
  if (sent >= MAX_UNACTIVATED_REMINDERS) return none;
  const elapsed = daysSinceIssued(pass, now);
  let earned = 0;
  for (const threshold of UNACTIVATED_REMINDER_DAYS) {
    if (elapsed >= threshold) earned += 1;
  }
  if (earned <= sent) return none;
  return {
    due: true,
    sequence: sent + 1,
    daysLeft: daysRemaining(pass, now),
    kind: 'activation_nudge',
  };
}

// Has the window closed on a pass we still have marked live? The cron flips
// these to 'expired' so admin lists and door lookups agree without every
// reader having to re-derive it from timestamps.
export function needsExpiryFlip(pass, now = new Date()) {
  if (!pass) return false;
  if (pass.status !== 'active' && pass.status !== 'extended') return false;
  return !isPassLive(pass, now);
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

// "August 19, 2026" in Austin time — how a date is written in guest-facing
// email and on the pass page. Venue timezone, not the server's, so a pass
// issued at 11:30pm Central does not show tomorrow's date to the guest holding
// it.
export function formatPassDate(value) {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function passStatusLabel(pass, now = new Date()) {
  if (!pass) return 'Not found';
  if (pass.status === 'converted') return 'Member';
  if (pass.status === 'applied') return 'Application submitted';
  if (!isPassLive(pass, now)) return 'Expired';
  if (pass.extended_until) return 'Extended';
  if (!isActivated(pass)) return 'Ready to use';
  return 'Active';
}
