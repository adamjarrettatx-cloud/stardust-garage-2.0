#!/usr/bin/env node
//
// ONE-TIME historical backfill of public.member_tickets.
//
// ---------------------------------------------------------------------------
// WHY
// ---------------------------------------------------------------------------
// member_tickets (supabase/migrations/20260727_member_tickets.sql) is the
// read-facing ticket wallet the mobile app queries under RLS. It is written
// only by the live TicketTailor webhook, so it holds nothing from before the
// day the wallet shipped and existing members would open the app to an empty
// list.
//
// No TicketTailor API call is needed: every order already in
// ticket_order_attribution stored its webhook payload verbatim in
// `raw_payload`, and that payload contains the full `issued_tickets` array.
// This script just replays that JSON through the exact same mapping the
// webhook uses (lib/member-tickets.js), so a backfilled row is
// indistinguishable from a webhook-written one.
//
// ---------------------------------------------------------------------------
// WHEN TO RUN IT
// ---------------------------------------------------------------------------
// Once, after deploying the webhook change. Safe to re-run at any time: the
// upsert is keyed on the TicketTailor issued_ticket id (ON CONFLICT (id) DO
// UPDATE), so a second pass refreshes rows in place and never duplicates.
// `created_at` is never sent, so a re-run leaves the original insert time
// alone.
//
// ---------------------------------------------------------------------------
// HOW TO RUN IT
// ---------------------------------------------------------------------------
//   npm run backfill:member-tickets -- --dry-run   # inspect first — writes nothing
//   npm run backfill:member-tickets                # perform the upsert
//
// Required environment (no new credentials — same vars the app already uses):
//   NEXT_PUBLIC_SUPABASE_URL    read by lib/supabase/admin.js
//   SUPABASE_SERVICE_ROLE_KEY   read by lib/supabase/admin.js
//
// A bare `node` process does not load .env.local the way `next` does, so on a
// machine that keeps secrets there, run it as:
//   node --env-file=.env.local scripts/backfill-member-tickets.mjs --dry-run
//
// Other flags:
//   --page-size=N   orders read per Supabase request (default 200)

import { createAdminClient } from '../lib/supabase/admin.js';
import {
  buildMemberTicketRows,
  issuedTicketEmails,
  loadMemberIdsByEmail,
  chunk,
} from '../lib/member-tickets.js';

const UPSERT_BATCH_SIZE = 500;

function parseArgs(argv) {
  const args = { dryRun: false, pageSize: 200 };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--page-size=')) args.pageSize = Number(arg.slice('--page-size='.length));
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isFinite(args.pageSize) || args.pageSize < 1) throw new Error('--page-size must be a positive number');
  return args;
}

// Every recorded order, oldest first. Paginated because .select() caps rows
// server-side and raw_payload is a fat column.
async function* iterateOrders(supabase, pageSize) {
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('ticket_order_attribution')
      .select('tt_order_id, local_event_id, status, raw_payload')
      .order('tt_order_id', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`failed to read ticket_order_attribution: ${error.message}`);
    if (!data?.length) return;
    yield data;
    if (data.length < pageSize) return;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Usage: node scripts/backfill-member-tickets.mjs [--dry-run] [--page-size=N]\n');
    return;
  }

  const mode = args.dryRun ? 'DRY RUN — nothing will be written' : 'LIVE — rows will be upserted';
  process.stdout.write(`\nmember_tickets backfill\n  mode: ${mode}\n\n`);

  const supabase = createAdminClient();

  const rows = [];
  const emails = new Set();
  let orderCount = 0;
  let ordersWithTickets = 0;

  for await (const page of iterateOrders(supabase, args.pageSize)) {
    for (const order of page) {
      orderCount += 1;
      const payload = order.raw_payload;
      if (!payload) continue;
      for (const email of issuedTicketEmails(payload)) emails.add(email);
      // Trust the attribution row's own columns over the payload's: they are
      // what the webhook resolved at delivery time and what the rest of the
      // app already reports on.
      const built = buildMemberTicketRows(payload, {
        localEventId: order.local_event_id,
        orderStatus: order.status ?? payload.status,
      });
      if (built.length) {
        ordersWithTickets += 1;
        rows.push(...built);
      }
    }
  }

  process.stdout.write(
    `Read ${orderCount} orders from ticket_order_attribution.\n`
    + `  orders with issued tickets: ${ordersWithTickets}\n`
    + `  orders with none:           ${orderCount - ordersWithTickets} (pending/canceled before issue, or no payload)\n`
    + `  tickets found:              ${rows.length}\n`
    + `  distinct buyer emails:      ${emails.size}\n\n`,
  );

  if (rows.length === 0) {
    process.stdout.write('Nothing to back fill.\n');
    return;
  }

  const memberIdByEmail = await loadMemberIdsByEmail(supabase, [...emails]);
  for (const row of rows) row.member_id = memberIdByEmail.get(row.buyer_email) || null;
  const matched = rows.filter((row) => row.member_id).length;
  process.stdout.write(
    `Matched ${memberIdByEmail.size} emails to member_profiles (${matched}/${rows.length} tickets carry a member_id).\n\n`,
  );

  const batches = chunk(rows, UPSERT_BATCH_SIZE);

  if (args.dryRun) {
    process.stdout.write(`DRY RUN: would upsert ${rows.length} rows in ${batches.length} batches. No writes performed.\n`);
    process.stdout.write(`Sample row: ${JSON.stringify(rows[0], null, 2)}\n`);
    return;
  }

  let written = 0;
  for (const [i, batch] of batches.entries()) {
    const { data, error } = await supabase
      .from('member_tickets')
      .upsert(batch, { onConflict: 'id' })
      .select('id');
    if (error) throw new Error(`batch ${i + 1}/${batches.length} failed: ${error.message}`);
    written += data?.length || 0;
    process.stdout.write(`  batch ${i + 1}/${batches.length}: ${data?.length || 0} rows upserted\n`);
  }

  const { count, error: countError } = await supabase
    .from('member_tickets')
    .select('id', { count: 'exact', head: true });
  if (countError) throw new Error(`failed to count member_tickets: ${countError.message}`);

  process.stdout.write(`\nDone.\n  upserted:               ${written}\n  total rows in member_tickets: ${count}\n`);
}

main().catch((err) => {
  process.stderr.write(`\nBackfill failed: ${err?.message || err}\n`);
  process.exitCode = 1;
});
