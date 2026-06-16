-- =========================================================
-- Event-level Financials  (additive — safe to apply)
--
-- This migration is PURELY ADDITIVE. It:
--   * adds contract financial-term columns to public.document_contracts
--   * creates public.event_financial_config   (per-event fee/split inputs)
--   * creates public.pos_import_batches        (one CSV import per upload)
--   * creates public.pos_import_rows           (parsed CSV rows, time-filtered)
--   * adds RLS policies that reuse the existing public.is_admin()
-- It does NOT alter or drop any existing column, table, or policy data.
--
-- Money is stored in integer minor units (cents), matching TicketTailor and
-- lib/event-analytics.js / lib/event-financials.js. No external credentials
-- are required to apply.
--
-- Per-event profit = TicketTailor net (gross - processor fees - CPT fee)
--   combined with imported POS net, then split per the contract terms.
-- The CPT (Cost Per Ticket) fee defaults to $0.52 per TT ticket sold.
-- =========================================================

-- ---------------------------------------------------------------------------
-- 1. Contract financial terms (extend document_contracts).
--    Extraction is best-effort/heuristic (see lib/contract-financials.js); an
--    admin can review + override the structured terms before they feed a
--    financial calculation. We keep the raw extracted text and a structured
--    jsonb blob, plus a few first-class columns the calc reads directly.
-- ---------------------------------------------------------------------------
alter table public.document_contracts
  add column if not exists financial_terms        jsonb  not null default '{}'::jsonb,
  add column if not exists financial_terms_source text   not null default 'none'
    check (financial_terms_source in ('none','extracted','manual','extracted_edited')),
  add column if not exists extracted_text         text,
  add column if not exists revenue_share_recipient text  not null default 'stardust'
    check (revenue_share_recipient in ('stardust','counterparty','split')),
  -- Stardust's share of TT net ticket profit, as a percentage 0..100. NULL
  -- means "no split configured" (Stardust keeps 100% by default in the calc).
  add column if not exists stardust_split_percent numeric(5,2)
    check (stardust_split_percent is null or (stardust_split_percent >= 0 and stardust_split_percent <= 100)),
  -- Flat fee (cents) owed under the contract, e.g. "$500 flat fee".
  add column if not exists flat_fee_cents         bigint,
  add column if not exists financial_terms_reviewed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Per-event financial configuration. One row per event holds the fee
--    inputs the calculation needs that are NOT derivable from TT/POS data:
--    the CPT fee, sales-tax rate, and an optional credit-card fee rate that
--    apply to that event. A contract may also be linked for the split terms.
-- ---------------------------------------------------------------------------
create table if not exists public.event_financial_config (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique
    references public.events(id) on delete cascade,

  -- TicketTailor Cost-Per-Ticket fee in cents per ticket sold (default $0.52).
  tt_cpt_fee_cents integer not null default 52
    check (tt_cpt_fee_cents >= 0),

  -- Sales-tax rate applied to POS gross (basis points: 825 = 8.25%). POS rows
  -- may already carry tax; this is used only when a row's tax is unknown.
  sales_tax_bps integer not null default 0
    check (sales_tax_bps >= 0 and sales_tax_bps <= 10000),

  -- Credit-card processing fee rate on POS gross (basis points). Optional.
  cc_fee_bps integer not null default 0
    check (cc_fee_bps >= 0 and cc_fee_bps <= 10000),

  -- Optional override of the contract used for split terms. When null, the
  -- calc falls back to the most recent signed contract linked to the event.
  contract_id uuid references public.document_contracts(id) on delete set null,

  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists event_financial_config_event_id_idx on public.event_financial_config(event_id);
create index if not exists event_financial_config_contract_idx  on public.event_financial_config(contract_id);

-- ---------------------------------------------------------------------------
-- 3. POS CSV import batches. Each upload of a post-event POS CSV becomes one
--    batch tied to an event. The admin picks a date/time window; rows inside
--    the window are flagged `in_window` and contribute to the calculation.
-- ---------------------------------------------------------------------------
create table if not exists public.pos_import_batches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null
    references public.events(id) on delete cascade,

  source_filename text,
  -- Selected window (UTC instants). Rows whose timestamp falls within
  -- [window_start, window_end] are counted toward the event.
  window_start timestamptz,
  window_end   timestamptz,

  -- Roll-up totals (cents / counts) computed from in-window rows at import or
  -- on re-filter, so the summary query stays cheap.
  row_count       integer not null default 0,
  in_window_count integer not null default 0,
  gross_cents     bigint  not null default 0,
  tax_cents       bigint  not null default 0,
  cc_fee_cents    bigint  not null default 0,
  net_cents       bigint  not null default 0,

  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pos_import_batches_event_id_idx on public.pos_import_batches(event_id);

-- Individual parsed POS rows. Kept so the admin can re-filter the window
-- without re-uploading, and so totals are auditable.
create table if not exists public.pos_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null
    references public.pos_import_batches(id) on delete cascade,

  -- Parsed transaction timestamp (UTC). Null if the CSV row had no usable time.
  occurred_at timestamptz,
  -- Whether this row falls within the batch's selected window.
  in_window boolean not null default false,

  gross_cents  bigint  not null default 0,
  tax_cents    bigint  not null default 0,
  cc_fee_cents bigint  not null default 0,
  net_cents    bigint  not null default 0,

  description text,
  -- Original CSV cells for audit/debugging.
  raw jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists pos_import_rows_batch_id_idx    on public.pos_import_rows(batch_id);
create index if not exists pos_import_rows_occurred_at_idx  on public.pos_import_rows(occurred_at);

-- ---------------------------------------------------------------------------
-- updated_at triggers (reuse a shared touch function per table).
-- ---------------------------------------------------------------------------
create or replace function public.event_financial_config_set_updated()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists event_financial_config_set_updated_trg on public.event_financial_config;
create trigger event_financial_config_set_updated_trg
before update on public.event_financial_config
for each row execute function public.event_financial_config_set_updated();

create or replace function public.pos_import_batches_set_updated()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists pos_import_batches_set_updated_trg on public.pos_import_batches;
create trigger pos_import_batches_set_updated_trg
before update on public.pos_import_batches
for each row execute function public.pos_import_batches_set_updated();

-- ---------------------------------------------------------------------------
-- RLS: admin-only, reusing the existing is_admin() definer function. The
-- service-role client (admin server components + routes) bypasses RLS. There
-- is NO public/anon policy — these are internal financial figures.
-- ---------------------------------------------------------------------------
alter table public.event_financial_config enable row level security;
drop policy if exists event_financial_config_admin_select on public.event_financial_config;
drop policy if exists event_financial_config_admin_insert on public.event_financial_config;
drop policy if exists event_financial_config_admin_update on public.event_financial_config;
drop policy if exists event_financial_config_admin_delete on public.event_financial_config;
create policy event_financial_config_admin_select on public.event_financial_config for select to authenticated using (public.is_admin());
create policy event_financial_config_admin_insert on public.event_financial_config for insert to authenticated with check (public.is_admin());
create policy event_financial_config_admin_update on public.event_financial_config for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy event_financial_config_admin_delete on public.event_financial_config for delete to authenticated using (public.is_admin());

alter table public.pos_import_batches enable row level security;
drop policy if exists pos_import_batches_admin_select on public.pos_import_batches;
drop policy if exists pos_import_batches_admin_insert on public.pos_import_batches;
drop policy if exists pos_import_batches_admin_update on public.pos_import_batches;
drop policy if exists pos_import_batches_admin_delete on public.pos_import_batches;
create policy pos_import_batches_admin_select on public.pos_import_batches for select to authenticated using (public.is_admin());
create policy pos_import_batches_admin_insert on public.pos_import_batches for insert to authenticated with check (public.is_admin());
create policy pos_import_batches_admin_update on public.pos_import_batches for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pos_import_batches_admin_delete on public.pos_import_batches for delete to authenticated using (public.is_admin());

alter table public.pos_import_rows enable row level security;
drop policy if exists pos_import_rows_admin_select on public.pos_import_rows;
drop policy if exists pos_import_rows_admin_insert on public.pos_import_rows;
drop policy if exists pos_import_rows_admin_update on public.pos_import_rows;
drop policy if exists pos_import_rows_admin_delete on public.pos_import_rows;
create policy pos_import_rows_admin_select on public.pos_import_rows for select to authenticated using (public.is_admin());
create policy pos_import_rows_admin_insert on public.pos_import_rows for insert to authenticated with check (public.is_admin());
create policy pos_import_rows_admin_update on public.pos_import_rows for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pos_import_rows_admin_delete on public.pos_import_rows for delete to authenticated using (public.is_admin());
