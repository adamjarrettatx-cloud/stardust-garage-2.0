-- =========================================================
-- Contract effective/expiration: date -> timestamptz
-- Builds on 20260614_contract_lifecycle.sql.
--
-- Contracts now capture an effective and expiration DATE & TIME, not just a
-- date. This migration promotes the two existing date columns on
-- public.document_contracts to timestamptz IN PLACE, preserving the column
-- names so application code and API payloads keep working unchanged.
--
-- SAFETY / DATA PRESERVATION:
--   * Postgres casts `date` -> `timestamptz` losslessly: an existing value of
--     2026-01-15 becomes 2026-01-15 00:00:00 in the database session timezone.
--     The USING clause below makes that cast explicit and pins it to UTC so the
--     result is deterministic regardless of the server's timezone setting.
--   * No rows are deleted and no data is dropped — only the column type widens.
--   * The ALTERs are guarded by a check on the current column type, so this
--     migration is idempotent: re-running it after the columns are already
--     timestamptz is a no-op.
--
-- This is an in-place type widening (chosen over adding parallel columns)
-- because the source columns hold only date precision today, the cast is
-- lossless, and keeping the same names avoids a dual-column compatibility shim
-- across the UI/API. See the PR description for the full rationale.
-- =========================================================

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'document_contracts'
      and column_name = 'effective_date'
      and data_type = 'date'
  ) then
    alter table public.document_contracts
      alter column effective_date type timestamptz
      using effective_date::timestamp at time zone 'UTC';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'document_contracts'
      and column_name = 'expiration_date'
      and data_type = 'date'
  ) then
    alter table public.document_contracts
      alter column expiration_date type timestamptz
      using expiration_date::timestamp at time zone 'UTC';
  end if;
end $$;
