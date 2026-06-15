-- =========================================================
-- Contract effective/expiration: date -> timestamptz
-- Builds on 20260614_contract_lifecycle.sql.
--
-- Contracts now capture an effective and expiration DATE & TIME, not just a
-- date. This migration promotes the two existing date columns on
-- public.document_contracts to timestamptz IN PLACE, preserving the column
-- names so application code and API payloads keep working unchanged.
--
-- TIMEZONE CONVENTION (must match lib/contract-helpers.js + ContractPanel.js):
--   Effective/expiration instants are venue-local wall-clock time. The venue is
--   in Austin, TX, so the canonical zone is America/Chicago (CST/CDT). An
--   existing date-only value therefore means "start of that day at the venue",
--   NOT UTC midnight. The USING clause below applies that interpretation:
--   `effective_date::timestamp` is midnight-of-date as a naive timestamp, and
--   `... at time zone 'America/Chicago'` reads that naive wall clock AS Chicago
--   local time and returns the matching timestamptz instant (DST-aware). So
--   2026-01-15 (CST) -> 2026-01-15 06:00:00+00, and a summer date under CDT
--   shifts by 5h instead of 6h automatically.
--
--   This deliberately differs from a naive UTC-midnight cast: it makes the
--   migrated instants agree with how the app parses and renders zoneless
--   values, so existing rows display on the correct venue day after deploy.
--
-- SAFETY / DATA PRESERVATION:
--   * No rows are deleted and no data is dropped — only the column type widens
--     and each date is reinterpreted as a venue-local instant.
--   * The ALTERs are guarded by a check on the current column type, so this
--     migration is idempotent: re-running it after the columns are already
--     timestamptz is a no-op. (Note: because the guard keys on data_type, the
--     reinterpretation runs exactly once, on the date -> timestamptz step.)
--
-- This is an in-place type widening (chosen over adding parallel columns)
-- because the source columns hold only date precision today and keeping the
-- same names avoids a dual-column compatibility shim across the UI/API. See the
-- PR description for the full rationale.
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
      using effective_date::timestamp at time zone 'America/Chicago';
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
      using expiration_date::timestamp at time zone 'America/Chicago';
  end if;
end $$;
