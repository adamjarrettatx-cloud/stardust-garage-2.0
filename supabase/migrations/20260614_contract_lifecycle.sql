-- =========================================================
-- Contract Lifecycle  (additive — safe to apply)
-- Builds on the Secure Document Hub (20260611_documents_hub.sql).
--
-- This migration is PURELY ADDITIVE:
--   * creates one new table (public.document_contracts)
--   * adds one new audit action value via a CHECK that supersedes the old one
--   * adds RLS policies that reuse the existing public.is_admin()
-- It does NOT alter or drop any existing column, table, or policy data.
--
-- A "contract" is an optional extension record for a document in the
-- 'contracts' category. It tracks signature status and e-signature provider
-- references (e.g. SignNow). No external credentials are required to apply.
-- =========================================================

create table if not exists public.document_contracts (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique
    references public.documents(id) on delete cascade,

  -- Lifecycle status. Mirrors lib/contract-helpers.js CONTRACT_STATUSES.
  status text not null default 'draft'
    check (status in (
      'draft','pending_review','sent','partially_signed',
      'signed','declined','void','expired'
    )),

  -- E-signature provider + opaque external references. Nullable until a
  -- contract is actually sent through a provider.
  signature_provider text not null default 'none'
    check (signature_provider in ('none','signnow','manual')),
  external_envelope_id text,        -- SignNow document/invite id
  external_template_id text,        -- SignNow template id, if used

  -- Counterparty / signer metadata.
  counterparty_name  text,
  counterparty_email text,
  signers jsonb not null default '[]'::jsonb,   -- array of signer objects

  -- Linkage to business entities (optional, additive references).
  event_id uuid references public.events(id) on delete set null,

  -- Important dates.
  effective_date date,
  expiration_date date,
  sent_at timestamptz,
  completed_at timestamptz,

  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists document_contracts_document_id_idx on public.document_contracts(document_id);
create index if not exists document_contracts_status_idx      on public.document_contracts(status);
create index if not exists document_contracts_event_id_idx    on public.document_contracts(event_id);
create index if not exists document_contracts_envelope_idx    on public.document_contracts(external_envelope_id);

-- Keep updated_at fresh.
create or replace function public.document_contracts_set_updated()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists document_contracts_set_updated_trg on public.document_contracts;
create trigger document_contracts_set_updated_trg
before update on public.document_contracts
for each row execute function public.document_contracts_set_updated();

-- RLS: admin-only, reusing the existing is_admin() definer function.
alter table public.document_contracts enable row level security;

drop policy if exists contracts_admin_select on public.document_contracts;
drop policy if exists contracts_admin_insert on public.document_contracts;
drop policy if exists contracts_admin_update on public.document_contracts;
drop policy if exists contracts_admin_delete on public.document_contracts;
create policy contracts_admin_select on public.document_contracts for select to authenticated using (public.is_admin());
create policy contracts_admin_insert on public.document_contracts for insert to authenticated with check (public.is_admin());
create policy contracts_admin_update on public.document_contracts for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy contracts_admin_delete on public.document_contracts for delete to authenticated using (public.is_admin());

-- Extend the audit-log action vocabulary to cover contract events.
-- The audit table already denies update/delete; we only widen the allowed
-- action set. Re-running is safe (drop-if-exists then add).
alter table public.document_audit_log drop constraint if exists document_audit_log_action_check;
alter table public.document_audit_log add constraint document_audit_log_action_check
  check (action in (
    'upload','view','download','update_metadata','delete','restore','new_version',
    'contract_create','contract_status_change','contract_send','contract_signed','contract_void'
  ));
