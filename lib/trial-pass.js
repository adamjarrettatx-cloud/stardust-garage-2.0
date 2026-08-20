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

// How long a new pass is live for. 30 days is the membership-application
// window Adam set: long enough to catch a guest who only comes out once or
// twice a month, short enough that it still feels like a deadline.
export const TRIAL_WINDOW_DAYS = 30;

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

// When does this pass actually stop working? `expires_at` is the original
// 30-day deadline and never moves; `extended_until` only exists if staff sold
// the 7-day extension. Taking the later of the two means a badly-timed
// extension (granted a day after expiry, say) can only ever help the guest,
// and re-running an extension is not able to shorten a pass.
export function effectiveExpiry(pass) {
  const expires = toDate(pass?.expires_at);
  const extended = toDate(pass?.extended_until);
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
// reminder emails show; 0 means "expires today".
export function daysRemaining(pass, now = new Date()) {
  const expiry = effectiveExpiry(pass);
  const at = toDate(now);
  if (!expiry || !at) return 0;
  return Math.max(0, Math.floor((expiry.getTime() - at.getTime()) / DAY_MS));
}

// Days elapsed since issue — the axis the reminder schedule is measured on.
export function daysSinceIssued(pass, now = new Date()) {
  const issued = toDate(pass?.issued_at) || toDate(pass?.created_at);
  const at = toDate(now);
  if (!issued || !at) return 0;
  return Math.max(0, Math.floor((at.getTime() - issued.getTime()) / DAY_MS));
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

  return {
    valid: true,
    data: {
      full_name: nameRaw,
      phone: normalizePhone(phoneRaw),
      email: emailRaw.toLowerCase(),
    },
  };
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
    return {
      result: DOOR_RESULTS.denied_expired,
      allowed: false,
      reason: 'Trial pass expired.',
      // The one thing staff can do about it, spelled out on the screen.
      staffAction: `Offer the $${TRIAL_EXTENSION_PRICE_USD} ${TRIAL_EXTENSION_DAYS}-day extension if they bought a ticket.`,
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

// Is a nudge due for this pass today, and if so which one?
//
// Driven off (days since issue, reminders already sent) rather than "has it
// been six days since the last email", so a cron outage cannot silently skip a
// guest's whole sequence: whenever it next runs, the pass is behind schedule
// and gets exactly one catch-up nudge, not four at once.
//
// Returns { due, sequence, daysLeft } — sequence is 1..MAX_REMINDERS and is
// the `sequence` written to trial_pass_emails, which is what makes a repeated
// cron run a no-op rather than a second email.
export function reminderDueFor(pass, now = new Date()) {
  const none = { due: false, sequence: null, daysLeft: 0 };
  if (!pass) return none;

  // Reminders exist to get someone to apply. Once they have, the sequence is
  // over — including for a pass that later converts.
  if (pass.applied_at || pass.converted_at) return none;
  if (pass.status === 'applied' || pass.status === 'converted') return none;
  if (!isPassLive(pass, now)) return none;

  const sent = Number.isInteger(pass.reminders_sent) ? pass.reminders_sent : 0;
  if (sent >= MAX_REMINDERS) return none;

  const elapsed = daysSinceIssued(pass, now);
  const earned = Math.min(MAX_REMINDERS, Math.floor(elapsed / REMINDER_INTERVAL_DAYS));
  if (earned <= sent) return none;

  return { due: true, sequence: sent + 1, daysLeft: daysRemaining(pass, now) };
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
  return 'Active';
}
