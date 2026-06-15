-- =========================================================
-- POS Core  (Phase 1 — additive, safe to apply)
--
-- Processor-agnostic point-of-sale data model for Stardust Garage's two
-- countertop terminals (with cash drawers) and three handhelds.
--
-- This migration is PURELY ADDITIVE:
--   * creates pos_* tables only
--   * adds RLS policies that REUSE the existing public.is_admin() definer
--     function (defined in 20260611_documents_hub.sql, reads team_members)
--   * introduces a sibling public.is_team() definer (team OR admin) so the
--     register UI can be operated by any team member, mirroring the
--     requireTeam() gate in lib/auth-helpers.js
--   * service_role bypasses RLS for server route handlers
-- It does NOT alter or drop any existing column, table, or policy.
--
-- IMPORTANT (Phase 1): NO live card processing. Tender is recorded, not
-- charged. `payment_processor_key` / `processor_key` are opaque labels for a
-- future adapter selection (Authorize.net, Aeropay, etc.) — no credentials
-- live in the schema.
--
-- Restricted-tender business rule: THCA/kava/kanna and similar
-- cannabinoid-adjacent SKUs can be flagged cash_only or
-- approved_processor_only so they are never charged through a disallowed
-- tender. The policy is snapshotted onto each order line for an immutable
-- audit trail.
-- =========================================================

-- ---------------------------------------------------------------------------
-- is_team(): true for any active team member (role 'team' or 'admin').
-- Mirrors requireTeam() in lib/auth-helpers.js. security definer + pinned
-- search_path, same pattern as is_admin(). Reads the server-controlled
-- team_members table, NOT user_metadata (Supabase advisor 0015).
-- ---------------------------------------------------------------------------
create or replace function public.is_team()
returns boolean language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.team_members
    where user_id = auth.uid() and role in ('team', 'admin')
  );
$$;
revoke all on function public.is_team() from public;
grant execute on function public.is_team() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger function for pos_* tables.
-- ---------------------------------------------------------------------------
create or replace function public.pos_set_updated()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end; $$;

-- ===========================================================================
-- pos_products
-- ===========================================================================
create table if not exists public.pos_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  sku text unique,
  barcode text,
  category text,
  price_cents integer not null default 0 check (price_cents >= 0),
  -- Tax expressed in basis points (e.g. 825 = 8.25%). Null/0 => taxable flag
  -- decides. Keeping both lets a product be explicitly tax-exempt.
  tax_rate_bps integer not null default 0 check (tax_rate_bps between 0 and 10000),
  taxable boolean not null default true,
  active boolean not null default true,
  age_restricted boolean not null default false,
  -- Restricted-tender policy. Matches RESTRICTED_TENDER_POLICIES in
  -- lib/pos-helpers.js. 'none' = chargeable on any tender.
  restricted_tender_policy text not null default 'none'
    check (restricted_tender_policy in ('none', 'cash_only', 'approved_processor_only')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pos_products_active_idx   on public.pos_products(active);
create index if not exists pos_products_category_idx on public.pos_products(category);
create index if not exists pos_products_sku_idx      on public.pos_products(sku);
create index if not exists pos_products_barcode_idx  on public.pos_products(barcode);
create index if not exists pos_products_sort_idx     on public.pos_products(sort_order);

drop trigger if exists pos_products_set_updated_trg on public.pos_products;
create trigger pos_products_set_updated_trg
before update on public.pos_products
for each row execute function public.pos_set_updated();

-- ===========================================================================
-- pos_terminals
-- ===========================================================================
create table if not exists public.pos_terminals (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  terminal_type text not null default 'countertop'
    check (terminal_type in ('countertop', 'handheld')),
  location text,
  active boolean not null default true,
  -- Opaque key naming a future processor adapter. NULL in Phase 1.
  payment_processor_key text,
  cash_drawer_attached boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pos_terminals_active_idx on public.pos_terminals(active);
create index if not exists pos_terminals_type_idx   on public.pos_terminals(terminal_type);

drop trigger if exists pos_terminals_set_updated_trg on public.pos_terminals;
create trigger pos_terminals_set_updated_trg
before update on public.pos_terminals
for each row execute function public.pos_set_updated();

-- ===========================================================================
-- pos_cash_sessions  (created before pos_orders so orders can reference it)
-- ===========================================================================
create table if not exists public.pos_cash_sessions (
  id uuid primary key default gen_random_uuid(),
  terminal_id uuid references public.pos_terminals(id) on delete set null,
  opened_by uuid references auth.users(id) on delete set null,
  closed_by uuid references auth.users(id) on delete set null,
  opening_cash_cents integer not null default 0 check (opening_cash_cents >= 0),
  closing_cash_cents integer check (closing_cash_cents >= 0),
  -- Expected = opening + cash sales recorded against this session. Computed by
  -- the server at close time; stored for the reconciliation report.
  expected_cash_cents integer,
  status text not null default 'open' check (status in ('open', 'closed')),
  notes text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pos_cash_sessions_terminal_idx on public.pos_cash_sessions(terminal_id);
create index if not exists pos_cash_sessions_status_idx    on public.pos_cash_sessions(status);

-- At most one OPEN session per terminal.
create unique index if not exists pos_cash_sessions_one_open_per_terminal
  on public.pos_cash_sessions(terminal_id) where status = 'open';

drop trigger if exists pos_cash_sessions_set_updated_trg on public.pos_cash_sessions;
create trigger pos_cash_sessions_set_updated_trg
before update on public.pos_cash_sessions
for each row execute function public.pos_set_updated();

-- ===========================================================================
-- pos_orders
-- ===========================================================================
create table if not exists public.pos_orders (
  id uuid primary key default gen_random_uuid(),
  -- Human-friendly public id (e.g. SG-2026-000123). Set by the server.
  order_number text unique,
  terminal_id uuid references public.pos_terminals(id) on delete set null,
  cash_session_id uuid references public.pos_cash_sessions(id) on delete set null,
  -- The team/admin user who rang the order. Nullable for system-created rows.
  cashier_id uuid references auth.users(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'paid', 'void', 'refunded')),
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  tax_cents       integer not null default 0 check (tax_cents >= 0),
  discount_cents  integer not null default 0 check (discount_cents >= 0),
  total_cents     integer not null default 0 check (total_cents >= 0),
  -- Set when any line carries a non-'none' restricted_tender_policy. Lets the
  -- orders list flag restricted sales without re-scanning line items.
  restricted_items_present boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pos_orders_status_idx   on public.pos_orders(status);
create index if not exists pos_orders_terminal_idx on public.pos_orders(terminal_id);
create index if not exists pos_orders_session_idx  on public.pos_orders(cash_session_id);
create index if not exists pos_orders_created_idx  on public.pos_orders(created_at desc);

drop trigger if exists pos_orders_set_updated_trg on public.pos_orders;
create trigger pos_orders_set_updated_trg
before update on public.pos_orders
for each row execute function public.pos_set_updated();

-- ===========================================================================
-- pos_order_items
-- ===========================================================================
create table if not exists public.pos_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pos_orders(id) on delete cascade,
  -- Product link is nullable + ON DELETE SET NULL: deleting a product must not
  -- erase historical sales. The name/sku/policy snapshots preserve the record.
  product_id uuid references public.pos_products(id) on delete set null,
  name_snapshot text not null,
  sku_snapshot text,
  quantity integer not null default 1 check (quantity > 0),
  unit_price_cents integer not null default 0 check (unit_price_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  line_total_cents integer not null default 0 check (line_total_cents >= 0),
  restricted_tender_policy text not null default 'none'
    check (restricted_tender_policy in ('none', 'cash_only', 'approved_processor_only')),
  created_at timestamptz not null default now()
);

create index if not exists pos_order_items_order_idx   on public.pos_order_items(order_id);
create index if not exists pos_order_items_product_idx on public.pos_order_items(product_id);

-- ===========================================================================
-- pos_payments
-- ===========================================================================
create table if not exists public.pos_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pos_orders(id) on delete cascade,
  tender_type text not null
    check (tender_type in ('cash', 'card', 'manual_external', 'ach', 'comp', 'other')),
  -- Opaque processor adapter key. NULL for cash/comp/manual_external in Phase 1.
  processor_key text,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'voided', 'refunded')),
  amount_cents integer not null check (amount_cents >= 0),
  -- For manual_external this holds the operator-entered reference from the
  -- standalone card device; for a future live processor it's the gateway id.
  processor_transaction_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pos_payments_order_idx  on public.pos_payments(order_id);
create index if not exists pos_payments_status_idx on public.pos_payments(status);
create index if not exists pos_payments_tender_idx on public.pos_payments(tender_type);

drop trigger if exists pos_payments_set_updated_trg on public.pos_payments;
create trigger pos_payments_set_updated_trg
before update on public.pos_payments
for each row execute function public.pos_set_updated();

-- ===========================================================================
-- Row Level Security
--
-- Reads: any team member (is_team) may read POS data to operate the register.
-- Writes: SELECT/INSERT/UPDATE are allowed for team members; DELETE is
-- admin-only to preserve sales history. service_role (server routes) bypasses
-- RLS entirely. All mutations in Phase 1 go through gated server routes that
-- use the service-role client, so these policies are defense-in-depth.
-- ===========================================================================

-- Helper to keep the policy block compact: every pos_* table gets the same
-- team-read / team-write / admin-delete shape.
do $$
declare
  t text;
  pos_tables text[] := array[
    'pos_products', 'pos_terminals', 'pos_cash_sessions',
    'pos_orders', 'pos_order_items', 'pos_payments'
  ];
begin
  foreach t in array pos_tables loop
    execute format('alter table public.%I enable row level security;', t);

    execute format('drop policy if exists %I on public.%I;', t || '_team_select', t);
    execute format('drop policy if exists %I on public.%I;', t || '_team_insert', t);
    execute format('drop policy if exists %I on public.%I;', t || '_team_update', t);
    execute format('drop policy if exists %I on public.%I;', t || '_admin_delete', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_team());',
      t || '_team_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_team());',
      t || '_team_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_team()) with check (public.is_team());',
      t || '_team_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_admin());',
      t || '_admin_delete', t);
  end loop;
end $$;
