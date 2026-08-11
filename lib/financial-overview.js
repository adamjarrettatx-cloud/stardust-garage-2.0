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
