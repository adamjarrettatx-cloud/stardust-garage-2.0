-- =========================================================
-- Financial Cash-Flow Ledger — MVP Phase 1  (additive — safe to apply)
--
-- This migration is PURELY ADDITIVE:
--   * creates three new tables (financial_accounts, financial_transactions,
--     spoton_import_batches)
--   * seeds the two Phase-1 accounts (TicketTailor, SpotOn POS)
--   * adds OWNER-only RLS policies to all three
--   * widens the existing document_audit_log action vocabulary (drop-if-exists
--     then re-add, exactly as 20260614_contract_lifecycle.sql does)
-- It does NOT alter or drop any existing column, table, policy, or data. In
-- particular it does NOT touch public.events, public.event_ticket_metrics,
-- public.tt_discovered_events, or public.manual_income_entries.
--
-- Purpose: a macro-level "money in vs money out" ledger across every account
-- the business uses. Phase 1 feeds it from two sources only — the existing
-- read-only TicketTailor metrics cache and manually uploaded SpotOn POS CSVs.
-- The schema deliberately carries `txn_type` and a generic `source` column now
-- so later phases (Mercury bank, Amex, Cash App, owner draws) can be added
-- without a rework.
--
-- MONEY REPRESENTATION — note the deviation from the rest of the repo. The
-- financial-calendar pipeline stores integer cents (bigint). This ledger stores
-- `numeric(14,2)` because the spec defines the column that way and because a
-- unified ledger will later ingest bank/credit-card exports that are already
-- decimal. numeric is exact (not float), so no precision is lost. The app layer
-- still does ALL arithmetic in integer cents (lib/financial-ledger.js) and only
-- converts at the DB boundary, so nothing downstream has to trust a decimal.
-- =========================================================

-- ---------------------------------------------------------------------------
-- Accounts: one row per money source/destination.
-- ---------------------------------------------------------------------------
create table if not exists public.financial_accounts (
  id uuid primary key default gen_random_uuid(),

  -- Display name, also the natural key used by the seed below and by the
  -- server-side sync (it resolves "TicketTailor" -> id rather than hard-coding
  -- a uuid in application code).
  name text not null unique check (char_length(btrim(name)) between 1 and 120),

  -- Kept as checked text rather than a Postgres enum so a new account type can
  -- ship without an ALTER TYPE migration. The canonical list also lives in
  -- lib/financial-ledger.js (ACCOUNT_TYPES).
  account_type text not null
    check (account_type in ('ticketing', 'pos', 'bank', 'credit_card', 'cash', 'manual')),

  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists financial_accounts_active_idx on public.financial_accounts(is_active);

-- Phase-1 accounts. Idempotent: re-running the migration leaves existing rows
-- (and their ids, which transactions reference) untouched.
insert into public.financial_accounts (name, account_type)
values ('TicketTailor', 'ticketing'),
       ('SpotOn POS', 'pos')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- SpotOn CSV import batches. Created BEFORE financial_transactions so the
-- ledger can reference a batch.
--
-- Two-step flow: the upload endpoint parses the file and writes a 'pending'
-- batch holding the raw rows; the confirm endpoint re-derives every amount from
-- those stored rows. Client-supplied totals are never persisted.
-- ---------------------------------------------------------------------------
create table if not exists public.spoton_import_batches (
  id uuid primary key default gen_random_uuid(),

  filename text not null check (char_length(btrim(filename)) between 1 and 300),
  uploaded_by uuid references auth.users(id) on delete set null,

  -- The confirmed field -> CSV column mapping ({ date: 'Business Date', ... }).
  -- Null while the batch is still pending a mapping decision.
  column_mapping jsonb,

  row_count integer not null default 0 check (row_count >= 0),

  -- How the CSV rows became ledger rows. SpotOn's "order item list view" export
  -- is one row per sold item, so it is summed into one row per calendar date
  -- ('daily'); an export that is already daily/batch level maps straight through
  -- ('row').
  aggregation text not null default 'daily'
    check (aggregation in ('daily', 'row')),

  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'failed')),

  -- Parsed CSV rows preserved verbatim for traceability/audit and for a future
  -- phase-2 re-derivation with a corrected mapping.
  raw_rows jsonb,

  -- sha-256 of the uploaded file bytes, used to detect a re-upload of a file
  -- that has already been imported.
  file_hash text,

  error_detail text,

  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index if not exists spoton_import_batches_status_idx  on public.spoton_import_batches(status, created_at desc);
create index if not exists spoton_import_batches_created_idx on public.spoton_import_batches(created_at desc);

-- Only one CONFIRMED batch may exist per file hash — a partial unique index, so
-- repeated pending/failed attempts at the same file are still allowed. This is
-- the hard backstop behind the app-level duplicate warning.
create unique index if not exists spoton_import_batches_confirmed_hash_uidx
  on public.spoton_import_batches(file_hash)
  where status = 'confirmed' and file_hash is not null;

-- ---------------------------------------------------------------------------
-- The unified ledger. Every account/source feeds into this one table.
-- ---------------------------------------------------------------------------
create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),

  account_id uuid not null references public.financial_accounts(id) on delete restrict,

  -- The date the money movement is RECOGNIZED. For TicketTailor that is the
  -- ticket sale date (matching event_ticket_metrics), not the payout date.
  transaction_date date not null,

  -- Always positive; `direction` carries the sign. See the money note above for
  -- why this is numeric rather than integer cents.
  amount numeric(14,2) not null check (amount >= 0),

  direction text not null check (direction in ('in', 'out')),

  -- 'transfer' rows move money between the business's own accounts and MUST be
  -- excluded from inflow/outflow totals to avoid double counting; 'financing'
  -- covers owner contributions/draws. Phase 1 only ever writes 'operating' —
  -- the column exists now so later phases don't need a schema change.
  txn_type text not null default 'operating'
    check (txn_type in ('operating', 'transfer', 'financing')),

  -- Light categories only (e.g. "Ticket Revenue", "POS Revenue"). Free text on
  -- purpose: this is not itemized bookkeeping.
  category text check (category is null or char_length(category) <= 120),

  -- Originating system. Checked text rather than an enum for the same
  -- extensibility reason as account_type; canonical list in
  -- lib/financial-ledger.js (SOURCES).
  source text not null check (char_length(btrim(source)) between 1 and 64),

  -- Stable pointer back to the originating record: the TT event series id, or
  -- "<batch id>:<row index>" for a SpotOn row. Combined with `source` this is
  -- what makes the TicketTailor sync idempotent (see the unique index below).
  external_ref text check (external_ref is null or char_length(external_ref) <= 200),

  -- Populated for TicketTailor rows that map to a local event. ON DELETE SET
  -- NULL so deleting an event never deletes the money it earned.
  linked_event_id uuid references public.events(id) on delete set null,

  -- The originating SpotOn batch, when this row came from a CSV import.
  import_batch_id uuid references public.spoton_import_batches(id) on delete set null,

  -- Raw provenance: the untouched CSV row, or the metrics snapshot the TT sync
  -- derived this amount from. Preserved so a phase-2 breakdown (tips, refunds,
  -- processing fees) can be computed without re-importing.
  metadata jsonb,

  notes text check (notes is null or char_length(notes) <= 2000),

  -- Admin who triggered the import/sync. Server sets this from the session.
  created_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists financial_transactions_date_idx    on public.financial_transactions(transaction_date desc);
create index if not exists financial_transactions_account_idx on public.financial_transactions(account_id, transaction_date desc);
create index if not exists financial_transactions_source_idx  on public.financial_transactions(source);
create index if not exists financial_transactions_event_idx   on public.financial_transactions(linked_event_id);
create index if not exists financial_transactions_batch_idx   on public.financial_transactions(import_batch_id);

-- Idempotency key for automated syncs: re-running the TicketTailor sync must
-- UPDATE the existing row for an event rather than insert a second one. Partial
-- (external_ref is not null) so hand-created rows without a ref are unaffected.
create unique index if not exists financial_transactions_source_ref_uidx
  on public.financial_transactions(source, external_ref)
  where external_ref is not null;

create or replace function public.financial_transactions_set_updated()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists financial_transactions_set_updated_trg on public.financial_transactions;
create trigger financial_transactions_set_updated_trg
before update on public.financial_transactions
for each row execute function public.financial_transactions_set_updated();

-- ---------------------------------------------------------------------------
-- RLS: OWNER-only reads AND writes on all three tables.
--
-- Matches public.manual_income_entries (20260723) rather than the broader
-- is_admin() posture of event_ticket_metrics: this is whole-business cash flow,
-- so a non-owner admin or team member must not be able to read it. public.
-- is_owner() is defined in 20260723_manual_income_entries.sql; it is created
-- here too (create or replace, identical body) so this migration can be applied
-- to an environment where that one has not run yet.
--
-- The service-role client used by the owner-gated server component and the
-- owner-gated API routes bypasses RLS; these policies are defense-in-depth so a
-- direct authenticated client cannot reach the data.
-- ---------------------------------------------------------------------------
create or replace function public.is_owner()
returns boolean language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid()
      and lower(email) = 'adam@sdgatx.com'
  );
$$;
revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated, anon;

alter table public.financial_accounts     enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.spoton_import_batches  enable row level security;

drop policy if exists financial_accounts_owner_select on public.financial_accounts;
drop policy if exists financial_accounts_owner_insert on public.financial_accounts;
drop policy if exists financial_accounts_owner_update on public.financial_accounts;
drop policy if exists financial_accounts_owner_delete on public.financial_accounts;
create policy financial_accounts_owner_select on public.financial_accounts for select to authenticated using (public.is_owner());
create policy financial_accounts_owner_insert on public.financial_accounts for insert to authenticated with check (public.is_owner());
create policy financial_accounts_owner_update on public.financial_accounts for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy financial_accounts_owner_delete on public.financial_accounts for delete to authenticated using (public.is_owner());

drop policy if exists financial_transactions_owner_select on public.financial_transactions;
drop policy if exists financial_transactions_owner_insert on public.financial_transactions;
drop policy if exists financial_transactions_owner_update on public.financial_transactions;
drop policy if exists financial_transactions_owner_delete on public.financial_transactions;
create policy financial_transactions_owner_select on public.financial_transactions for select to authenticated using (public.is_owner());
create policy financial_transactions_owner_insert on public.financial_transactions for insert to authenticated with check (public.is_owner());
create policy financial_transactions_owner_update on public.financial_transactions for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy financial_transactions_owner_delete on public.financial_transactions for delete to authenticated using (public.is_owner());

drop policy if exists spoton_import_batches_owner_select on public.spoton_import_batches;
drop policy if exists spoton_import_batches_owner_insert on public.spoton_import_batches;
drop policy if exists spoton_import_batches_owner_update on public.spoton_import_batches;
drop policy if exists spoton_import_batches_owner_delete on public.spoton_import_batches;
create policy spoton_import_batches_owner_select on public.spoton_import_batches for select to authenticated using (public.is_owner());
create policy spoton_import_batches_owner_insert on public.spoton_import_batches for insert to authenticated with check (public.is_owner());
create policy spoton_import_batches_owner_update on public.spoton_import_batches for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy spoton_import_batches_owner_delete on public.spoton_import_batches for delete to authenticated using (public.is_owner());

-- ---------------------------------------------------------------------------
-- Audit vocabulary. The ledger reuses public.document_audit_log rather than
-- standing up a second audit table, so every sensitive admin action stays in
-- one queryable place. document_id/version_id are simply left null for these
-- rows; the ledger context goes in `details`.
--
-- The audit table already denies update/delete; we only widen the allowed
-- action set. Re-running is safe (drop-if-exists then add).
-- ---------------------------------------------------------------------------
alter table public.document_audit_log drop constraint if exists document_audit_log_action_check;
alter table public.document_audit_log add constraint document_audit_log_action_check
  check (action in (
    'upload','view','download','update_metadata','delete','restore','new_version',
    'contract_create','contract_status_change','contract_send','contract_signed','contract_void',
    'ledger_tickettailor_sync','ledger_spoton_upload','ledger_spoton_confirm'
  ));
