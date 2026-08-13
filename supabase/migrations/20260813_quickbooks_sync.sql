-- =========================================================
-- QuickBooks Online native sync — additive, safe to apply.
--
-- The financial ledger already carries 834 QuickBooks-sourced rows
-- (source='quickbooks', external_ref='qbo:{Type}:{Id}:{LineNum}') from a
-- one-time manual backfill done 2026-07-26. Those rows are untouched by this
-- migration. This adds what a recurring, self-serve OAuth sync needs:
--
--   * qbo_connections — the one OAuth token pair this app holds for the
--     single connected QuickBooks company, plus a sync watermark.
--   * a "QuickBooks (Mercury)" bank account so future synced rows have
--     somewhere to attach (financial_accounts.name is the natural key the
--     app resolves at write time — see lib/financial-ledger.js ACCOUNT_NAMES).
--   * two new document_audit_log action strings for connect/sync events,
--     following the same drop-if-exists-then-widen pattern as
--     20260726_financial_ledger.sql.
--
-- No existing table, column, policy, or row is altered or dropped.
-- =========================================================

-- ---------------------------------------------------------------------------
-- The QuickBooks bank/Mercury account. 'bank' already exists in
-- financial_accounts.account_type's check constraint (see the Phase-1
-- migration), so no constraint change is needed here.
-- ---------------------------------------------------------------------------
insert into public.financial_accounts (name, account_type)
values ('QuickBooks (Mercury)', 'bank')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- OAuth token storage. This app connects to exactly one QuickBooks company,
-- so realm_id is unique — a reconnect (or connecting a different company)
-- upserts on realm_id rather than requiring a delete first. Tokens are
-- opaque bearer strings from Intuit; nothing here parses or trusts their
-- contents (see lib/quickbooks.js for the token exchange/refresh calls).
-- ---------------------------------------------------------------------------
create table if not exists public.qbo_connections (
  id uuid primary key default gen_random_uuid(),

  realm_id text not null unique check (char_length(btrim(realm_id)) between 1 and 64),

  access_token text not null,
  refresh_token text not null,

  -- QBO access tokens last ~1 hour; refresh tokens last ~100 days and ROTATE
  -- on every refresh call (see lib/quickbooks.js refreshTokens). Both
  -- expiries are tracked so the sync route knows when to refresh, and the
  -- owner can be told if the refresh token itself has lapsed from inactivity.
  access_token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz not null,

  environment text not null default 'production'
    check (environment in ('sandbox', 'production')),

  -- Sync watermark: the sync route filters QuickBooks' Metadata.LastUpdatedTime
  -- by this value (not TxnDate), so edits to already-synced transactions are
  -- picked up, not just new ones. Null means "never synced" — the first sync
  -- anchors to Jan 1 of the current year (see yearToDateRange in
  -- lib/financial-ledger.js) rather than QuickBooks' full history.
  last_synced_at timestamptz,

  connected_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.qbo_connections_set_updated()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists qbo_connections_set_updated_trg on public.qbo_connections;
create trigger qbo_connections_set_updated_trg
before update on public.qbo_connections
for each row execute function public.qbo_connections_set_updated();

-- OWNER-only reads AND writes — same posture as financial_transactions.
-- public.is_owner() is defined in 20260726_financial_ledger.sql.
alter table public.qbo_connections enable row level security;

drop policy if exists qbo_connections_owner_select on public.qbo_connections;
drop policy if exists qbo_connections_owner_insert on public.qbo_connections;
drop policy if exists qbo_connections_owner_update on public.qbo_connections;
drop policy if exists qbo_connections_owner_delete on public.qbo_connections;
create policy qbo_connections_owner_select on public.qbo_connections for select to authenticated using (public.is_owner());
create policy qbo_connections_owner_insert on public.qbo_connections for insert to authenticated with check (public.is_owner());
create policy qbo_connections_owner_update on public.qbo_connections for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy qbo_connections_owner_delete on public.qbo_connections for delete to authenticated using (public.is_owner());

-- ---------------------------------------------------------------------------
-- Audit vocabulary.
-- ---------------------------------------------------------------------------
alter table public.document_audit_log drop constraint if exists document_audit_log_action_check;
alter table public.document_audit_log add constraint document_audit_log_action_check
  check (action in (
    'upload','view','download','update_metadata','delete','restore','new_version',
    'contract_create','contract_status_change','contract_send','contract_signed','contract_void',
    'ledger_tickettailor_sync','ledger_spoton_upload','ledger_spoton_confirm',
    'ledger_quickbooks_connect','ledger_quickbooks_sync','ledger_quickbooks_disconnect'
  ));
