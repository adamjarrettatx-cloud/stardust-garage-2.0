-- =========================================================
-- Event financials — contract terms snapshot  (additive — safe to apply)
--
-- This migration is PURELY ADDITIVE. It adds optional snapshot columns to
-- public.event_financial_config so that reviewed contract split/flat-fee terms
-- can be preserved onto the event itself. This protects closed-event books:
-- once an admin snapshots the terms, deleting the underlying contract document
-- (which ON DELETE SET NULL clears contract_id) no longer retroactively changes
-- the split — the calc falls back to the snapshot instead of "100% Stardust".
--
-- It does NOT alter or drop any existing column, table, policy, or data, and it
-- reuses the existing admin-only RLS already on event_financial_config (no new
-- policies needed — these are columns on an already-protected table).
--
-- Money stays in integer minor units (cents), matching the rest of the schema.
-- =========================================================

alter table public.event_financial_config
  -- Snapshotted split percentage (Stardust's share of TT net, 0..100). NULL
  -- means no snapshot has been taken.
  add column if not exists snapshot_stardust_split_percent numeric(5,2)
    check (snapshot_stardust_split_percent is null
           or (snapshot_stardust_split_percent >= 0 and snapshot_stardust_split_percent <= 100)),

  -- Snapshotted flat fee owed under the contract, in cents.
  add column if not exists snapshot_flat_fee_cents bigint
    check (snapshot_flat_fee_cents is null or snapshot_flat_fee_cents >= 0),

  -- Snapshotted revenue-share recipient, mirroring document_contracts.
  add column if not exists snapshot_revenue_share_recipient text
    check (snapshot_revenue_share_recipient is null
           or snapshot_revenue_share_recipient in ('stardust','counterparty','split')),

  -- When the snapshot was taken, and which contract it was copied from. The
  -- contract reference is ON DELETE SET NULL so the snapshot survives deletion
  -- (the snapshot terms themselves are plain columns and are never cleared).
  add column if not exists snapshot_taken_at timestamptz,
  add column if not exists snapshot_contract_id uuid
    references public.document_contracts(id) on delete set null;
