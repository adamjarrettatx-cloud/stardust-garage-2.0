# Financial Cash Flow Runbook

Operational guide for the owner-only Cash Flow dashboard (Ledger MVP, phase 1).
**This file contains NO secrets — only the names of environment variables and
how the feature is wired up.**

## What it does

- Presents **macro-level money in vs money out** across accounts from one
  unified ledger (`public.financial_transactions`).
- Phase 1 populates two sources:
  1. **TicketTailor** — synced from the existing `public.event_ticket_metrics`
     cache. The sync does **not** call the TicketTailor API.
  2. **SpotOn POS** — manual CSV upload with a preview → column mapping →
     confirm flow.
- This is **not itemized bookkeeping**: sales tax, processing fees, and contract
  splits are not deducted. TicketTailor rows record **gross**.

## Route & access control

| Item | Value |
| --- | --- |
| Route | `/bananas/cash-flow` |
| Nav entry | Admin dashboard → **Analytics** tab → **Cash Flow** tile (owner-only) |
| Page gate | `ownerPageGate()` (server-side) |

Authorization matches `/bananas/financial-calendar`: authenticated → admin per
`team_members.role` (never `user_metadata`) → owner email from `auth.users` →
MFA stepped-up (`aal2`) when `ENFORCE_ADMIN_MFA=true`. The DB enforces the same
boundary independently via owner-only RLS on all three new tables, so hiding the
tile is not the security boundary.

| Endpoint | Method | Purpose | Auth |
| --- | --- | --- | --- |
| `/api/admin/financial-ledger/sync-tickettailor` | `POST` | Rebuild TicketTailor ledger rows from the metrics cache | `requireOwner()` + same-origin |
| `/api/admin/financial-ledger/spoton-import` | `POST` | Stage a CSV upload (parse + preview, nothing written to the ledger) | `requireOwner()` + same-origin |
| `/api/admin/financial-ledger/spoton-import` | `PATCH` | Confirm a staged batch with a column mapping | `requireOwner()` + same-origin |
| `/api/admin/financial-ledger/spoton-import` | `DELETE` | Discard a still-pending batch | `requireOwner()` + same-origin |

## Data model

`supabase/migrations/20260726_financial_ledger.sql` (additive) creates:

- **`financial_accounts`** — one row per money bucket (`ticketing`, `pos`,
  `bank`, `credit_card`, `cash`, `manual`). Seeds `TicketTailor` and
  `SpotOn POS`; `on conflict (name) do nothing`, so re-running is safe.
- **`financial_transactions`** — the ledger. `amount numeric(14,2)` with a
  non-negative check; sign lives in `direction` (`in`/`out`), and `txn_type`
  (`operating`/`transfer`/`financing`) exists so **transfers between the
  business's own accounts are excluded from every total** rather than
  double-counting cash flow. Only `operating` rows are written this phase.
- **`spoton_import_batches`** — the staged upload: `raw_rows`, the confirmed
  `column_mapping`, `file_hash`, and `status` (`pending`/`confirmed`/`failed`).

Two partial unique indexes carry the correctness guarantees:

- `financial_transactions (source, external_ref) where external_ref is not null`
  makes both writers **idempotent** — re-syncing TicketTailor or re-confirming a
  batch updates in place instead of duplicating money. Because the index is
  partial, no `ON CONFLICT` / PostgREST `.upsert()` can target it; both writers go
  through `writeLedgerRows` in `lib/financial-ledger-write.js`, which matches
  existing rows on `(source, external_ref)` and then updates or inserts.
- `spoton_import_batches (file_hash) where status = 'confirmed'` detects a
  byte-identical re-upload. It **warns** rather than blocks; the admin must tick
  an acknowledgement (which sends `force: true`) to import it again.

The migration also widens the `document_audit_log_action_check` constraint with
`ledger_tickettailor_sync`, `ledger_spoton_upload`, and `ledger_spoton_confirm`,
so ledger writes land in the existing audit log alongside document actions.

### Money representation

The ledger stores `numeric(14,2)` (per the spec) while **every calculation in JS
happens in integer cents** via `centsToAmount()` / `amountToCents()` in
`lib/financial-ledger.js`. This differs from the rest of the repo, which stores
`bigint` cents directly. `tests/financial-ledger.test.mjs` locks the round trip
through the numeric boundary so no cent is lost in either direction.

## TicketTailor sync

`buildTicketTailorLedgerRows()` reads events + cached metrics and emits one
inflow per event:

- **Recognition date = `events.event_date`.** `event_ticket_metrics` is an
  aggregate per event with no per-order timestamps, so this matches the
  attribution the Financial Calendar already uses. Per-day *sale* dates are a
  phase-2 change on top of `ticket_order_attribution`.
- **Amount = gross.** Fee deduction is explicitly out of scope; `fees_cents` and
  `net_cents` are preserved in `metadata` for later.
- `external_ref = events.id`, so a re-sync updates the same row.
- Rows are **skipped**, never fabricated as `$0`, when the event has no metrics,
  a non-`ok` status (`pending` / `not_configured` / `error`), genuinely zero
  gross, or no date. The response reports each skip count.

## SpotOn CSV import

The flow assumes **no** layout. `suggestMapping()` proposes a mapping from the
detected headers and leaves an unrecognized file entirely unmapped rather than
guessing wrong; every field can be re-pointed or left unmapped by hand.

1. **Upload (`POST`)** — `.csv` extension required, MIME checked against an
   allow-list, 10MB cap re-checked against the *actual* bytes read (`file.size`
   is client metadata), UTF-8 BOM stripped. Duplicate/blank headers are made
   distinct (`Amount (2)`, `Column 4`) so a column cannot silently overwrite
   another. The parsed rows are stored as a `pending` batch. **Nothing reaches
   the ledger.**
2. **Map** — date is required, plus at least one of net deposit, net sales, or
   gross sales (tips/refunds/fees alone cannot say how much money moved).
   `validateMapping()` runs client-side purely for fast feedback; the server
   re-runs it against the headers of the **stored** rows.
3. **Confirm (`PATCH`)** — amounts are re-derived server-side from the staged
   rows; the only things accepted from the client are the column mapping and the
   aggregation mode. `net_deposit` wins when mapped, then `net_sales`, else
   `gross + tips − |refunds| − |fees|` (refunds/fees are treated as magnitudes so
   an export that writes them negative cannot flip a subtraction into an
   addition). A net-negative date is a real **outflow** categorized
   `POS Refunds`, not clamped to zero. Zero amounts are dropped and undated rows
   reported.

### Aggregation modes

SpotOn's **"order item list view"** export is one row per *sold item*, not a
daily settlement file — the validation export was 9,260 rows over 50 days, with
no fees, tips, or net-deposit column anywhere. So the confirm step has two modes,
both always selectable:

| Mode | `external_ref` | When |
| --- | --- | --- |
| `daily` | `{batchId}:{YYYY-MM-DD}` | Item-level export: line items summed into one ledger row per calendar date. |
| `row` | `{batchId}:{rowIndex}` | An export that is already daily or batch level. |

`detectItemizedExport()` picks the default (a row-level amount column plus ≥3 of
the item-level markers — `Item Name`, `Menu Item Price`, `Order ID`, `Is Void`,
`Is Refund`, `Voided Sales Amount`, …), the dialog pre-selects it and says why,
and the server re-resolves it from the *stored* headers so an unknown value can
never take effect. The chosen mode is persisted on the batch.

Voids and refunds are **counted, not filtered**: the export already zeroes a
voided line (parking its amount in `Voided Sales Amount`) and already writes a
refund negative, so summing the mapped amount nets both out with no
special-casing. Filtering them again would double-exclude.

**Taxes are never part of the ledger amount.** Each aggregated row instead
carries a `metadata` breakdown — `line_item_count`, `void_row_count`,
`refund_row_count`, per-day `taxes_cents` / `gross_sales_cents` /
`discounts_cents` / `voided_amount_cents`, and per-category subtotals
(`Tickets`, `Beverages`, `Lockers`, `Uncategorized`, …, capped at 60 with the
remainder rolled into `(other)`) — so a later sales-tax or per-category pass
needs no re-import. `category` stays `POS Revenue`; the ledger is deliberately
not fragmented per item category this phase. Aggregated rows omit `raw_row`
(the staged batch's `raw_rows` keeps full per-line traceability); per-row imports
still keep the untouched CSV row.

Closing the dialog before confirming best-effort DELETEs the pending batch;
a leftover `pending` batch is simply ignored by the dashboard.

## One-time deployment

1. **Apply the migration** (`supabase db push`, or run the SQL against the
   project): `supabase/migrations/20260726_financial_ledger.sql`. Purely
   additive and safe to re-run. Until it is applied the page renders a
   "Ledger tables not found" notice instead of erroring.
2. **Deploy** so the two API routes are live.
3. **Backfill TicketTailor**: open `/bananas/cash-flow` and press
   **Sync TicketTailor**. Re-runnable at will — it upserts.
4. **Import SpotOn** history via **Import SpotOn CSV**, one export at a time.
5. **Verify**: totals, the by-account breakdown, and the 12-month trend chart
   populate; a TicketTailor row links back to its event page.

### Environment variables

| Var | Purpose |
| --- | --- |
| `ENFORCE_ADMIN_MFA` | When `true`, requires a stepped-up (aal2) session for admin pages. |

No new external API credentials are needed — the sync reads the existing cache
and SpotOn is a manual upload.

## Deferred scope (intentionally NOT built)

- Cash App / Amex / Mercury integrations, and SpotOn API automation.
- Manual owner-contribution entries.
- Sales tax, credit-card fee, and contract-split deductions.
- Any `transfer` or `financing` rows — the column exists and is already excluded
  from totals, but nothing writes one yet.

## Tests

- `tests/financial-ledger.test.mjs` — cents/numeric round trips, date helpers,
  transfer exclusion from totals, per-account and monthly aggregation, and the
  TicketTailor row builder (gross on event date, idempotent `external_ref`,
  skip classification).
- `tests/spoton-import.test.mjs` — CSV parsing and header deduping, date
  parsing, mapping suggestion/validation/sanitization, amount derivation
  precedence and negative-magnitude handling, inflow/outflow classification, and
  ledger-row traceability. Plus a synthetic item-level fixture (multiple rows per
  day, a zeroed void line, a negative refund line, several categories) covering
  shape detection, day grouping, taxes-excluded-from-amount, void/refund counts,
  per-category subtotals, and date-keyed `external_ref`. No real business data is
  committed.
- Run: `npm test`.
