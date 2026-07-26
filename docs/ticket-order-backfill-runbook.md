# TicketTailor Order Backfill Runbook

One-time procedure for populating `public.ticket_order_attribution` with
historical TicketTailor orders. **This file contains NO secrets — only the
names of environment variables and how the script is wired up.**

## Why this exists

`public.ticket_order_attribution` was created on **2026-07-25** by
`supabase/migrations/20260725_mailchimp_ticket_attribution.sql`, for a purpose
that had nothing to do with reporting: matching Mailchimp email clicks to ticket
purchases. Its only writer is the live webhook
(`app/api/webhooks/tickettailor/route.js`), which records an order when
TicketTailor fires `ORDER.CREATED` / `ORDER.UPDATED`.

Nothing ever backfilled it, so the table starts on the day it was created.

That went unnoticed until the sales-over-time chart on `/bananas/analytics`
(added in PR #56) began reading the table as a revenue source. The chart is
correct; its input is incomplete. The symptom is real dollars for late July 2026
and **$0 for February through June**, despite the business selling tickets that
whole time.

This script fetches those historical orders from TicketTailor's API and inserts
the missing rows.

## When to run it

**Once.** Ongoing orders arrive through the live webhook, so a second run after
a successful pass finds nothing to do.

It is safe to re-run regardless — the insert is
`ON CONFLICT (tt_order_id) DO NOTHING`, so it never duplicates a row and never
overwrites one the webhook already wrote.

## Prerequisites

| Variable | Used by | Purpose |
| --- | --- | --- |
| `TICKETTAILOR_API_KEY` | `lib/tickettailor.js` | HTTP Basic auth against `https://api.tickettailor.com/v1` |
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/supabase/admin.js` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase/admin.js` | Service-role write access |

These are the same variables the app already uses. The script introduces **no
new credentials** and reuses `ttFetch()` and `createAdminClient()` directly.

The service-role key is required because `ticket_order_attribution` is
RLS-protected with an owner-only `SELECT` policy and **no** insert policy — all
writes are server-side by design.

> A bare `node` process does not load `.env.local` the way `next` does. If your
> secrets live there, run the script with `node --env-file=.env.local ...`
> (see the exact command below) or export the three variables into the shell.

## Two ways to run it

**Option A — the admin button (easiest, no secrets to handle).** The deployed
app already has `TICKETTAILOR_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in its
server runtime, so the owner never has to put them in a shell:

1. Sign in as the owner and open `/bananas/analytics`.
2. Click **Backfill historical TT orders (one-time)**. The first click is always
   a dry run — it writes nothing.
3. Read the inline summary and apply the same sanity checks as step 2 below.
   The date range must start in early February.
4. Click **Confirm — write to database**. The control then shows a
   "Backfill completed" line with inserted / already-present counts.

The route behind it is `POST /api/admin/backfill-tt-orders`, gated by
`requireOwner()` plus a same-origin check, taking `{ dryRun: boolean }` that
defaults to `true` so a bare POST cannot write.

**Option B — the CLI**, below, for anyone who prefers a shell. Both paths run
the same logic (`lib/tt-order-backfill.js` via
`lib/tt-order-backfill-runner.js`), so they behave identically.

The prerequisites table above applies to Option B only; Option A needs nothing
beyond the env vars the app already has in production.

## Procedure (CLI)

### 1. Dry run first — always

```bash
npm run backfill:tt-orders -- --dry-run
```

Or, loading secrets from `.env.local`:

```bash
node --env-file=.env.local scripts/backfill-ticket-order-attribution.mjs --dry-run
```

This writes nothing. It paginates the TicketTailor API, maps every order, and
prints what it *would* insert:

```
TicketTailor order backfill
  mode: DRY RUN — nothing will be written
  window: 2026-02-01 through today

Loaded 42 local events for series matching.

Fetching orders from TicketTailor...
  page 1: 100 orders (100 total)
  page 2: 87 orders (187 total)
  reached orders before 2026-02-01 — stopping pagination

Fetched 187 orders from TicketTailor.
  in window:      164
  outside window: 23
  unusable:       0 (no order id or no usable timestamp)
  duplicate ids:  0
  completed:      151 orders worth $12,480.00
  date range:     2026-02-03 .. 2026-07-25 (Austin time)

DRY RUN: would insert 164 rows in 1 batches. No writes performed.
Sample row: { ... }
```

### 2. Sanity-check the dry-run output

Before writing anything, confirm:

- **The date range starts in early February**, not in July. A range that begins
  in July means the API returned nothing older and the backfill will not fix the
  chart.
- **The completed-order total is in the right ballpark** for Feb–Jul takings.
  Cross-check against the TicketTailor dashboard.
- **`unusable` is 0.** A non-zero count means orders arrived without an id or a
  usable timestamp; investigate before proceeding.
- **The sample row's `created_at` is a historical date**, not today. This is the
  single most important field — see "What could go wrong" below.

### 3. Run it for real

```bash
npm run backfill:tt-orders
```

The final summary reports inserted vs. already-present counts:

```
  batch 1/1: 147 inserted, 17 already present
Done.
  inserted:       147
  already present: 17
  covered:        2026-02-03 .. 2026-07-25 (Austin time)
```

The "already present" rows are the ones the live webhook has been recording
since 2026-07-25 — they are left untouched.

### 4. Verify

Load `/bananas/analytics` and switch the sales chart to **By month**. February
through June should now show real bars instead of $0.

## Flags

| Flag | Default | Purpose |
| --- | --- | --- |
| `--dry-run` | off | Fetch, map, and summarize without writing |
| `--start=YYYY-MM-DD` | `2026-02-01` | Override the window start |
| `--batch-size=N` | `200` | Rows per insert statement |
| `--max-pages=N` | `200` | Safety cap on API pagination (20,000 orders) |

The default start is `BACKFILL_START_DATE` in `lib/tt-order-backfill.js`, which
re-exports `SALES_DATA_START_DATE` from `lib/ticket-sales-timeseries.js`. The
backfill window and the chart's floor are therefore the same constant by
construction — moving one moves both.

## What could go wrong

**Rows stamped with today's date.** `ticket_order_attribution.created_at`
defaults to `now()`. An insert that omitted the column would file every
historical order under the run date, leaving the chart exactly as wrong while
appearing to have succeeded. The script sets `created_at` explicitly from
TicketTailor's own order timestamp, and a unit test asserts the mapped row's
month is not the current month.

**Unix seconds read as milliseconds.** TicketTailor sends `created_at` as unix
**seconds**. Treating it as milliseconds would place every 2026 order in January
1970. `ttOrderCreatedMs()` handles the conversion and is unit-tested.

**A wrong server-side date filter.** The script deliberately does *not* pass a
`created_at` bound to the API. TicketTailor's public reference renders its query
parameters client-side, so the exact spelling could not be confirmed, and a
misspelled filter param fails silently — the API would ignore it and the window
would never be applied. Instead the script paginates and filters locally, which
is unambiguous and cheap (TT permits 5,000 requests per 30 minutes; this is
roughly one request per 100 orders).

**Missing older orders.** TicketTailor returns orders newest-first, so the
script stops paginating once an entire page predates the start date. If the API
ever changes that ordering, the early stop could truncate the range — the
printed date range is the check: it must begin in early February.

## What this script does not do

- **No retroactive Mailchimp attribution.** `matched_mc_cid`,
  `matched_click_id`, `mailchimp_synced`, and `mailchimp_sync_error` are left at
  their column defaults on backfilled rows. `marketing_email_clicks` has no
  history for this period either, so there is nothing to match against. This
  backfill is about revenue history only.
- **No writes to TicketTailor.** It only ever issues `GET /v1/orders`.
- **No changes to the webhook.** Ongoing ingestion is unaffected.

## Related

| File | Role |
| --- | --- |
| `app/api/admin/backfill-tt-orders/route.js` | Owner-gated route behind the admin button |
| `app/bananas/analytics/BackfillTTOrdersButton.js` | The dry-run-then-confirm UI control |
| `scripts/backfill-ticket-order-attribution.mjs` | The CLI alternative (I/O, flags, batching) |
| `lib/tt-order-backfill-runner.js` | Shared fetch → map → insert orchestration |
| `lib/tt-order-backfill.js` | Pure mapping/filtering/pagination logic |
| `tests/tt-order-backfill.test.mjs` | Unit tests over mocked API responses |
| `lib/ticket-sales-timeseries.js` | The chart's bucketing; owns `SALES_DATA_START_DATE` |
| `app/api/webhooks/tickettailor/route.js` | The live writer this script mirrors |
