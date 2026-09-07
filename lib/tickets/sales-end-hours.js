// Helpers for the 'Ticket Sales End — N hours after doors open' control on
// the event editor's ticketing panel. Kept in plain JS (no React) so they can
// be exercised by node:test without a jsx toolchain.
//
// The UI persists a whole-hour offset by writing the derived timestamp into
// products.sales_end_at, so pricing.js (the runtime "can I still buy?" check)
// keeps working with a single authoritative column and no schema change.

import { parseSimpleClockMinutes } from '../tt-event-create.js';

// Loose start-time extractor for the ticketing panel.
//
// events.event_time in production is free text and, in practice, almost never
// looks like a bare clock value the strict parser wants. Real values look
// like '10PM - LATE', '9 PM - 2 AM', '10:00 PM', '6:30PM', '10 pm to late',
// 'noon', 'midnight'. All of those still have a well-defined START time —
// the first clock-shaped token in the string.
//
// This helper pulls that leading token out and hands it to the shared strict
// parser so we keep one source of truth for hour math. Everything else —
// ranges, ' - LATE' suffixes, weird separators, extra whitespace — is
// stripped. Returns minutes-since-midnight, or null when nothing clock-shaped
// leads the string.
//
// We deliberately do NOT relax parseSimpleClockMinutes itself, because the
// TicketTailor create flow uses it as a strict validator ("is this a value we
// can confidently send to TicketTailor as HH:MM:SS?"). Loosening that would
// silently accept ranges the TicketTailor API rejects.
function extractStartMinutes(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  // Named times that mean an exact wall-clock moment.
  if (/^noon\b/.test(trimmed)) return 12 * 60;
  if (/^midnight\b/.test(trimmed)) return 0;
  // Grab the first clock-shaped token: '10', '10pm', '10 pm', '10:30',
  // '10:30pm', '6:30 PM', '22:00'. Whatever follows (' - LATE', ' to 2 am',
  // etc.) is ignored.
  const match = trimmed.match(/^(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  if (!match) return null;
  return parseSimpleClockMinutes(match[1].replace(/\s+/g, ''));
}

// The dropdown offers common whole-hour offsets after doors open. Kept small
// on purpose — in practice we want sales to close within the first few hours
// of the night, not custom minute-level windows. Exported so both the form
// control and any future admin-facing docs stay in sync.
export const HOURS_AFTER_DOORS_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// Build a JS Date for the event's doors-open moment from event_date
// ('YYYY-MM-DD') + the free-text event_time ('10:00 PM', '7pm', '22:00', etc).
// Returns null when either input is missing or event_time isn't one of the
// simple clock shapes we can confidently parse. Uses the caller's local
// timezone (which for the Stardust admin team is America/Chicago) so the
// computed cutoff matches wall-clock "N hours after doors".
export function resolveEventStartDate(eventDate, eventStartTime) {
  if (!eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return null;
  const minutes = extractStartMinutes(eventStartTime);
  if (minutes == null) return null;
  const [y, m, d] = eventDate.split('-').map((n) => parseInt(n, 10));
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const date = new Date(y, m - 1, d, hh, mm, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Given the event's doors-open Date and a persisted sales_end_at ISO, return
// the whole-hour offset (>=1) if sales_end_at falls on an exact N-hour mark
// after doors. Anything else — no cutoff saved, unparseable, non-integer
// offset, or before doors — returns null so the dropdown falls back to the
// 'No cutoff' choice and shows a hint.
export function hoursAfterDoorsFromIso(iso, eventStart) {
  if (!iso || !eventStart) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = d.getTime() - eventStart.getTime();
  if (diffMs <= 0) return null;
  const hours = diffMs / (60 * 60 * 1000);
  if (!Number.isFinite(hours)) return null;
  // Allow a tiny drift (< 1 minute) from DST edges and float rounding.
  const rounded = Math.round(hours);
  if (Math.abs(hours - rounded) > 1 / 60) return null;
  return rounded >= 1 ? rounded : null;
}

// Compute the ISO string to persist as sales_end_at given the event's doors
// moment and a whole-hour offset. Returns null when the offset is null (user
// picked 'No cutoff') or when eventStart couldn't be resolved.
export function isoForHoursAfterDoors(eventStart, hoursAfterDoors) {
  if (!eventStart || hoursAfterDoors == null) return null;
  const n = Number(hoursAfterDoors);
  if (!Number.isFinite(n) || n < 1) return null;
  return new Date(eventStart.getTime() + n * 60 * 60 * 1000).toISOString();
}
