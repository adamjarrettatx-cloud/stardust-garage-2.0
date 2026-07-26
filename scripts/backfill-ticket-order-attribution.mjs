#!/usr/bin/env node
//
// ONE-TIME historical backfill of public.ticket_order_attribution.
//
// ---------------------------------------------------------------------------
// WHY
// ---------------------------------------------------------------------------
// ticket_order_attribution was created on 2026-07-25 for Mailchimp email-click
// attribution, and is only ever written by the live TicketTailor webhook
// (app/api/webhooks/tickettailor/route.js) on ORDER.CREATED / ORDER.UPDATED.
// It was never backfilled, so it holds nothing from before the day it was
// created. The sales-over-time chart at /bananas/analytics reads that table,
// which is why it shows real dollars only for late July 2026 and $0 for
// February through June even though the business has been selling tickets
// since February.
//
// This script reads the historical orders straight from TicketTailor's API and
// inserts the missing rows, with each row's `created_at` set to the order's
// REAL timestamp so the chart buckets it into the month it belongs to.
//
// ---------------------------------------------------------------------------
// WHEN TO RUN IT
// ---------------------------------------------------------------------------
// Once. Future orders arrive via the live webhook, so re-running it after a
// successful pass has nothing left to do. It is nonetheless safe to re-run: the
// insert is ON CONFLICT (tt_order_id) DO NOTHING, so it never duplicates and
// never overwrites a row the webhook already wrote.
//
// ---------------------------------------------------------------------------
// HOW TO RUN IT
// ---------------------------------------------------------------------------
//   npm run backfill:tt-orders -- --dry-run     # inspect first — writes nothing
//   npm run backfill:tt-orders                  # perform the insert
//
// Required environment (same variables the app already uses — this script adds
// no new credentials):
//   TICKETTAILOR_API_KEY        read by lib/tickettailor.js
//   NEXT_PUBLIC_SUPABASE_URL    read by lib/supabase/admin.js
//   SUPABASE_SERVICE_ROLE_KEY   read by lib/supabase/admin.js
//
// A bare `node` process does not load .env.local the way `next` does, so on a
// machine that keeps secrets there, run it as:
//   node --env-file=.env.local scripts/backfill-ticket-order-attribution.mjs --dry-run
//
// Other flags:
//   --start=YYYY-MM-DD   override the default start (lib/tt-order-backfill.js)
//   --batch-size=N       rows per insert statement (default 200)
//   --max-pages=N        safety cap on API pagination (default 200 = 20k orders)
//
// See docs/ticket-order-backfill-runbook.md for the full procedure.

import { ttFetch } from '../lib/tickettailor.js';
import { createAdminClient } from '../lib/supabase/admin.js';
import {
  BACKFILL_START_DATE,
  paginateOrders,
  selectBackfillRows,
  chunkRows,
  coveredDateRange,
  summarizeRows,
} from '../lib/tt-order-backfill.js';

const PAGE_SIZE = 100; // TicketTailor's maximum page size for list endpoints.

function parseArgs(argv) {
  const args = { dryRun: false, start: BACKFILL_START_DATE, batchSize: 200, maxPages: 200 };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--start=')) args.start = arg.slice('--start='.length);
    else if (arg.startsWith('--batch-size=')) args.batchSize = Number(arg.slice('--batch-size='.length));
    else if (arg.startsWith('--max-pages=')) args.maxPages = Number(arg.slice('--max-pages='.length));
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function usd(cents) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// One page of GET /v1/orders. TT authenticates via lib/tickettailor.js's
// ttFetch (HTTP Basic with TICKETTAILOR_API_KEY) — this script introduces no
// credential handling of its own.
function fetchOrderPage({ startingAfter }) {
  const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (startingAfter) qs.set('starting_after', startingAfter);
  return ttFetch(`/orders?${qs.toString()}`);
}

// events.tt_event_series_id -> events.id, so backfilled rows carry the same
// local_event_id link the webhook resolves per order.
async function loadLocalEventMap(supabase) {
  const { data, error } = await supabase
    .from('events')
    .select('id, tt_event_series_id')
    .not('tt_event_series_id', 'is', null);

  if (error) throw new Error(`failed to load events: ${error.message}`);
  return new Map((data || []).map((e) => [e.tt_event_series_id, e.id]));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Usage: node scripts/backfill-ticket-order-attribution.mjs [--dry-run] [--start=YYYY-MM-DD] [--batch-size=N] [--max-pages=N]\n');
    return;
  }

  const mode = args.dryRun ? 'DRY RUN — nothing will be written' : 'LIVE — rows will be inserted';
  process.stdout.write(`\nTicketTailor order backfill\n  mode: ${mode}\n  window: ${args.start} through today\n\n`);

  const supabase = createAdminClient();
  const localEventIdBySeriesId = await loadLocalEventMap(supabase);
  process.stdout.write(`Loaded ${localEventIdBySeriesId.size} local events for series matching.\n\nFetching orders from TicketTailor...\n`);

  const { orders: fetched, stoppedEarly, hitPageCap } = await paginateOrders({
    fetchPage: fetchOrderPage,
    startDate: args.start,
    maxPages: args.maxPages,
    onPage: ({ page, received, total }) => process.stdout.write(`  page ${page}: ${received} orders (${total} total)\n`),
  });

  if (stoppedEarly) process.stdout.write(`  reached orders before ${args.start} — stopping pagination\n`);
  if (hitPageCap) process.stdout.write(`  WARNING: hit the --max-pages=${args.maxPages} cap; older orders may remain unfetched\n`);

  const { rows, outOfWindow, unusable, duplicates } = selectBackfillRows(fetched, {
    startDate: args.start,
    localEventIdBySeriesId,
  });
  const totals = summarizeRows(rows);
  const range = coveredDateRange(rows);

  process.stdout.write(
    `\nFetched ${fetched.length} orders from TicketTailor.\n`
    + `  in window:      ${rows.length}\n`
    + `  outside window: ${outOfWindow}\n`
    + `  unusable:       ${unusable} (no order id or no usable timestamp)\n`
    + `  duplicate ids:  ${duplicates}\n`
    + `  completed:      ${totals.completed} orders worth ${usd(totals.grossCents)}\n`
    + `  date range:     ${range ? `${range.first} .. ${range.last}` : 'n/a'} (Austin time)\n\n`,
  );

  if (rows.length === 0) {
    process.stdout.write('Nothing to back fill.\n');
    return;
  }

  const batches = chunkRows(rows, args.batchSize);

  if (args.dryRun) {
    process.stdout.write(`DRY RUN: would insert ${rows.length} rows in ${batches.length} batches. No writes performed.\n`);
    process.stdout.write(`Sample row: ${JSON.stringify({ ...rows[0], raw_payload: '<full TT order object>' }, null, 2)}\n`);
    return;
  }

  let inserted = 0;
  for (const [i, batch] of batches.entries()) {
    // ignoreDuplicates maps to ON CONFLICT (tt_order_id) DO NOTHING, so rows the
    // live webhook already recorded are left exactly as they are. The select()
    // returns only the rows actually inserted, which is how we count skips.
    const { data, error } = await supabase
      .from('ticket_order_attribution')
      .upsert(batch, { onConflict: 'tt_order_id', ignoreDuplicates: true })
      .select('tt_order_id');

    if (error) throw new Error(`batch ${i + 1}/${batches.length} failed: ${error.message}`);

    inserted += data?.length || 0;
    process.stdout.write(`  batch ${i + 1}/${batches.length}: ${data?.length || 0} inserted, ${batch.length - (data?.length || 0)} already present\n`);
  }

  process.stdout.write(
    `\nDone.\n`
    + `  inserted:       ${inserted}\n`
    + `  already present: ${rows.length - inserted}\n`
    + `  covered:        ${range.first} .. ${range.last} (Austin time)\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`\nBackfill failed: ${err?.message || err}\n`);
  process.exitCode = 1;
});
