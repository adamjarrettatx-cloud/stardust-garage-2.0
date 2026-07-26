// Orchestrates the one-time historical TicketTailor order backfill.
//
// The pure mapping/filtering/pagination logic lives in lib/tt-order-backfill.js.
// This module is the glue that drives it against real I/O, and exists so the
// owner-facing admin route (app/api/admin/backfill-tt-orders) can run the exact
// same backfill the CLI script does without a project owner having to export
// production secrets into a shell.
//
// Both collaborators are injected — `fetchPage` for TicketTailor and `supabase`
// for the database — so the whole run is unit-testable against mocks and this
// file never touches process.env or constructs a credentialed client itself.

import {
  BACKFILL_START_DATE,
  paginateOrders,
  selectBackfillRows,
  chunkRows,
  coveredDateRange,
  summarizeRows,
} from './tt-order-backfill.js';

// events.tt_event_series_id -> events.id, so backfilled rows carry the same
// local_event_id link the live webhook resolves per order.
export async function loadLocalEventMap(supabase) {
  const { data, error } = await supabase
    .from('events')
    .select('id, tt_event_series_id')
    .not('tt_event_series_id', 'is', null);

  if (error) throw new Error(`failed to load events: ${error.message}`);
  return new Map((data || []).map((e) => [e.tt_event_series_id, e.id]));
}

// Fetch, map, and (unless dryRun) insert the historical orders.
//
// `dryRun` defaults to true: the only way to write is to ask for it explicitly.
// A dry run performs every read and every mapping step, so its counts are the
// real ones — it just stops short of the insert.
//
// Inserts use ON CONFLICT (tt_order_id) DO NOTHING, so rows the live webhook
// already wrote are never duplicated or overwritten and the whole run is safe
// to repeat.
export async function runTtOrderBackfill({
  fetchPage,
  supabase,
  dryRun = true,
  startDate = BACKFILL_START_DATE,
  batchSize = 200,
  maxPages = 200,
} = {}) {
  const startedAt = new Date().toISOString();
  const localEventIdBySeriesId = await loadLocalEventMap(supabase);

  const { orders, pages, stoppedEarly, hitPageCap } = await paginateOrders({
    fetchPage,
    startDate,
    maxPages,
  });

  const { rows, outOfWindow, unusable, duplicates } = selectBackfillRows(orders, {
    startDate,
    localEventIdBySeriesId,
  });
  const totals = summarizeRows(rows);
  const dateRange = coveredDateRange(rows);
  const batches = chunkRows(rows, batchSize);

  const summary = {
    dryRun,
    startDate,
    startedAt,
    pages,
    stoppedEarly,
    hitPageCap,
    fetched: orders.length,
    selected: rows.length,
    outOfWindow,
    unusable,
    duplicates,
    completed: totals.completed,
    grossCents: totals.grossCents,
    dateRange,
    batches: batches.length,
    inserted: 0,
    alreadyPresent: 0,
  };

  if (dryRun || rows.length === 0) {
    return { ...summary, written: false, finishedAt: new Date().toISOString() };
  }

  let inserted = 0;
  for (const [i, batch] of batches.entries()) {
    // ignoreDuplicates maps to ON CONFLICT (tt_order_id) DO NOTHING. The
    // select() comes back with only the rows actually inserted, which is how
    // the already-present count is derived rather than guessed.
    const { data, error } = await supabase
      .from('ticket_order_attribution')
      .upsert(batch, { onConflict: 'tt_order_id', ignoreDuplicates: true })
      .select('tt_order_id');

    if (error) throw new Error(`batch ${i + 1}/${batches.length} failed: ${error.message}`);
    inserted += data?.length || 0;
  }

  return {
    ...summary,
    written: true,
    inserted,
    alreadyPresent: rows.length - inserted,
    finishedAt: new Date().toISOString(),
  };
}
