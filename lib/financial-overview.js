// Pure data helpers for the merged Financials page (Event Analytics +
// Financial Calendar, unified).
//
// This module is the SINGLE canonical accounting source for the merged page.
// It fixes the accounting gap between the two original pages:
//   - Event Analytics' summarizePerformanceTotals() only summed local,
//     TT-linked events with hasData=true, silently excluding TicketTailor
//     -only discovered events and owner-entered manual income.
//   - Financial Calendar's summarizeIncome() tracked gross/tickets/orders but
//     never rolled up fees or net income.
//
// buildFinancialOverview() reuses buildFinancialCalendar() (lib/financial-
// calendar.js) as the deduped canonical entry list — local events + TT-
// discovered-only events + manual income, with manual income linked to a
// local event folded into that event exactly once — and rolls portfolio
// totals up from THAT list, so every dollar the business has recorded is
// counted exactly once, regardless of source. Member-code engagement
// (lib/event-analytics.js) is attached per local, non-manual entry so the
// Performance tab can show the same code metrics the old Event Analytics
// page did.
//
// MONEY is integer minor units (cents), matching the rest of the codebase.

import { buildFinancialCalendar } from './financial-calendar.js';
import { groupCodesByEvent, summarizeMemberCodes } from './event-analytics.js';
import { CATEGORY } from './financial-ledger.js';

// True combined net income for one calendar entry (see lib/financial-
// calendar.js for entry shapes). TicketTailor fees are already deducted in
// `netCents`; manual income carries no fees, so its full amount is net.
//   - Manual-only entry (isManual): grossCents IS the net (no fees).
//   - TT-only / discovered entry: netCents is the TT net (fees deducted).
//   - Combined entry (TT event with manual income folded in via
//     attachManualIncomeToEvent): netCents is still the TT-only net — the
//     manual portion never touched it — so the manual gross must be added
//     back in to avoid undercounting net for that event.
export function entryNetCents(entry) {
  if (!entry) return 0;
  if (entry.isManual) return Number(entry.grossCents) || 0;
  return (Number(entry.netCents) || 0) + (Number(entry.manualGrossCents) || 0);
}

// Build the unified financial overview for the merged page.
//   events, metrics, discovered, manual — same shapes buildFinancialCalendar
//     already expects (see lib/financial-calendar.js).
//   codes — public.member_discount_codes rows (see lib/event-analytics.js).
// Returns:
//   entries          — full canonical, deduped calendar entry list (drives
//                       the Calendar tab), each carrying `.memberCodes` when
//                       it represents a local, non-manual event.
//   performanceRows  — entries filtered to local, non-manual events, sorted
//                       by event date descending (drives the Performance tab
//                       table — one row per website event, TT-linked or not).
//   totals           — portfolio-wide accounting totals computed once over
//                       `entries`, so TT-linked, TT-discovered-only, and
//                       manual income are all counted exactly once.
export function buildFinancialOverview({
  events = [],
  metrics = [],
  discovered = [],
  manual = [],
  codes = [],
  today = new Date(),
} = {}) {
  const entries = buildFinancialCalendar({ events, metrics, discovered, manual, today });

  const codesByEvent = groupCodesByEvent(codes);
  for (const entry of entries) {
    if (entry.hasLocalEvent && !entry.isManual) {
      entry.memberCodes = summarizeMemberCodes(codesByEvent[entry.id] || []);
    }
  }

  const performanceRows = entries
    .filter((e) => e.hasLocalEvent && !e.isManual)
    .slice()
    .sort((a, b) => String(b.eventDate || '').localeCompare(String(a.eventDate || '')));

  const totals = entries.reduce(
    (acc, e) => {
      const gross = Number(e.grossCents) || 0;
      const fees = Number(e.feesCents) || 0;
      acc.grossCents += gross;
      acc.feesCents += fees;
      acc.netCents += entryNetCents(e);
      acc.ticketsSold += Number(e.ticketsSold) || 0;
      acc.ordersCount += Number(e.ordersCount) || 0;
      if (gross > 0) acc.revenueEntries += 1;
      if (e.isManual) acc.manualEntries += 1;
      acc.manualEntries += e.manualEntries?.length || 0;
      if (e.fetchedAt && (!acc.lastUpdated || e.fetchedAt > acc.lastUpdated)) {
        acc.lastUpdated = e.fetchedAt;
      }
      return acc;
    },
    {
      events: 0,
      ttLinked: 0,
      manualEntries: 0,
      revenueEntries: 0,
      memberCodes: 0,
      codesSent: 0,
      grossCents: 0,
      feesCents: 0,
      netCents: 0,
      ticketsSold: 0,
      ordersCount: 0,
      lastUpdated: null,
    },
  );

  totals.events = performanceRows.length;
  totals.ttLinked = performanceRows.filter((r) => r.ttLinked).length;
  totals.memberCodes = performanceRows.reduce((sum, r) => sum + (r.memberCodes?.total || 0), 0);
  totals.codesSent = performanceRows.reduce((sum, r) => sum + (r.memberCodes?.sent || 0), 0);

  return { entries, performanceRows, totals };
}

// ---------------------------------------------------------------------------
// Every-dollar-per-day tracking (day / week / month rollups, all sources)
// ---------------------------------------------------------------------------
//
// Everything above is EVENT-centric: money only surfaces if it is tied to a
// named event (local, TT-discovered, or a manual entry linked/attached to
// one). But real revenue also lands on days with no event at all — a SpotOn
// point-of-sale sale on an ordinary weekday, for example — and the owner
// explicitly wants every dollar mapped day-over-day / week-over-week /
// month-over-month regardless of whether an "event" happened. The functions
// below answer that different question without touching the event-centric
// path above: they combine the same `entries` list with SpotOn ledger rows
// (public.financial_transactions, source='spoton_csv') into one calendar-day
// timeline, so the two views can never disagree about a given day's money.

// SpotOn CSV rows are already one row per calendar day per category — the
// importer "sums the mapped amount across every line item of a day" before
// insert (see SpotOnImportDialog) — but a day can still end up with more than
// one matching row (e.g. a revenue row + a refund row, or a re-import), so
// every row for a date is summed rather than assumed unique. Returns a Map
// keyed by YYYY-MM-DD -> { date, revenueCents, refundCents }.
export function summarizePosByDay(transactions = []) {
  const byDate = new Map();
  for (const txn of transactions) {
    if (!txn || txn.source !== 'spoton_csv' || !txn.date) continue;
    if (!byDate.has(txn.date)) {
      byDate.set(txn.date, { date: txn.date, revenueCents: 0, refundCents: 0 });
    }
    const bucket = byDate.get(txn.date);
    const cents = Number(txn.amountCents) || 0;
    // A day whose refunds exceed its sales is honestly an outflow (see
    // lib/financial-ledger.js CATEGORY.posRefund) — key off direction first
    // since that is what the ledger actually enforces, with category as a
    // secondary signal for any row that predates a category being set.
    if (txn.direction === 'out' || txn.category === CATEGORY.posRefund) {
      bucket.refundCents += cents;
    } else {
      bucket.revenueCents += cents;
    }
  }
  return byDate;
}

// One row per calendar date that has ANY recorded money — a website/TT event,
// owner-entered manual income, SpotOn POS activity, or any combination —
// merging the event-centric `entries` list (lib/financial-calendar.js) with
// SpotOn POS-by-day totals so a plain weekday with only bar sales shows up
// exactly like a day with a named event, just without `hasEvent`. Days with
// nothing recorded at all are omitted; a caller that needs a continuous
// timeline (e.g. a chart x-axis) fills gaps itself.
//   entries         — output of buildFinancialCalendar()/buildFinancialOverview()
//   posTransactions — normalizeTransaction() rows from lib/financial-ledger.js
export function buildDailyRevenue({ entries = [], posTransactions = [] } = {}) {
  const posByDate = summarizePosByDay(posTransactions);
  const byDate = new Map();

  const dayRow = (date) => {
    if (!byDate.has(date)) {
      byDate.set(date, {
        date,
        entries: [],
        // True only when a real event happened this day (local, TT-discovered,
        // or an event with manual income folded in). A standalone manual entry
        // (e.g. a venue rental with no linked event) does NOT set this — it is
        // real income, just not evidence of an "event" on the calendar.
        hasEvent: false,
        eventGrossCents: 0,
        eventNetCents: 0,
        posRevenueCents: 0,
        posRefundCents: 0,
      });
    }
    return byDate.get(date);
  };

  for (const entry of entries) {
    const date = entry?.eventDate;
    if (!date) continue;
    const row = dayRow(date);
    row.entries.push(entry);
    if (!entry.isManual) row.hasEvent = true;
    row.eventGrossCents += Number(entry.grossCents) || 0;
    row.eventNetCents += entryNetCents(entry);
  }

  for (const pos of posByDate.values()) {
    const row = dayRow(pos.date);
    row.posRevenueCents += pos.revenueCents;
    row.posRefundCents += pos.refundCents;
  }

  return Array.from(byDate.values())
    .map((row) => {
      const posNetCents = row.posRevenueCents - row.posRefundCents;
      return {
        ...row,
        posNetCents,
        totalGrossCents: row.eventGrossCents + row.posRevenueCents,
        totalNetCents: row.eventNetCents + posNetCents,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ISO week (Monday-start) key for a YYYY-MM-DD date string, e.g. "2026-W33".
// Uses the standard ISO-8601 rule (the week containing the year's first
// Thursday is week 1) so this matches every other "week number" a spreadsheet
// or calendar app would show for the same date.
export function isoWeekKey(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Shift to the Thursday of this date's own week: ISO weekday 1(Mon)..7(Sun).
  const isoWeekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (4 - isoWeekday));
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNum = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
}

// Monday..Sunday boundaries (YYYY-MM-DD) of the calendar week containing
// `dateStr`, used only to build a human-friendly week label/range.
function isoWeekRange(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const isoWeekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - (isoWeekday - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: monday, end: sunday };
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function weekLabel(dateStr) {
  const { start, end } = isoWeekRange(dateStr);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const startLabel = `${MONTH_ABBR[start.getUTCMonth()]} ${start.getUTCDate()}`;
  const endLabel = sameMonth ? `${end.getUTCDate()}` : `${MONTH_ABBR[end.getUTCMonth()]} ${end.getUTCDate()}`;
  return `${startLabel}–${endLabel}`;
}

function monthLabel(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  return `${MONTH_ABBR[m - 1]} ${y}`;
}

function dayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${MONTH_ABBR[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

// Bucket a buildDailyRevenue() row list into 'day' | 'week' | 'month'
// granularity for trend views. 'day' is a passthrough (already daily) plus a
// display label; 'week' buckets by ISO week (Monday start); 'month' buckets
// by calendar month. Every money field sums across the bucket; `days` counts
// how many source rows landed in it (so a chart/table can show density, e.g.
// "3 of 7 days" for a partial current week). Sorted by key ascending.
export function rollupDailyRevenue(dailyRows = [], granularity = 'day') {
  if (granularity === 'day') {
    return dailyRows
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        key: row.date,
        label: dayLabel(row.date),
        tooltipLabel: row.date,
        days: 1,
        hasEvent: row.hasEvent,
        eventGrossCents: row.eventGrossCents,
        eventNetCents: row.eventNetCents,
        posRevenueCents: row.posRevenueCents,
        posRefundCents: row.posRefundCents,
        posNetCents: row.posNetCents,
        totalGrossCents: row.totalGrossCents,
        totalNetCents: row.totalNetCents,
      }));
  }

  const keyFor = granularity === 'month' ? (d) => d.slice(0, 7) : isoWeekKey;
  const labelFor = granularity === 'month' ? monthLabel : weekLabel;

  const buckets = new Map();
  for (const row of dailyRows) {
    const key = keyFor(row.date);
    if (!key) continue;
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label: labelFor(row.date),
        tooltipLabel: granularity === 'month' ? labelFor(row.date) : `Week of ${labelFor(row.date)}`,
        days: 0,
        hasEvent: false,
        eventGrossCents: 0,
        eventNetCents: 0,
        posRevenueCents: 0,
        posRefundCents: 0,
        posNetCents: 0,
        totalGrossCents: 0,
        totalNetCents: 0,
      });
    }
    const bucket = buckets.get(key);
    bucket.days += 1;
    if (row.hasEvent) bucket.hasEvent = true;
    bucket.eventGrossCents += row.eventGrossCents;
    bucket.eventNetCents += row.eventNetCents;
    bucket.posRevenueCents += row.posRevenueCents;
    bucket.posRefundCents += row.posRefundCents;
    bucket.posNetCents += row.posNetCents;
    bucket.totalGrossCents += row.totalGrossCents;
    bucket.totalNetCents += row.totalNetCents;
  }

  return Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));
}
