-- =========================================================
-- Event End Time  (additive — safe to apply)
--
-- This migration is PURELY ADDITIVE:
--   * adds one nullable column (public.events.event_end_time)
-- It does NOT alter or drop any existing column, policy, or data. Existing
-- rows get NULL for event_end_time, which renders exactly as today (no end
-- time shown).
--
-- Purpose: the admin TicketTailor event creator (see app/admin/components/
-- TtEventCreator.js and lib/tt-event-create.js) now collects an event END time
-- alongside the existing free-text start time (events.event_time). Storing it
-- locally keeps the website event window in sync with the TicketTailor event
-- series end_date that the create flow now sends.
--
-- event_end_time mirrors event_time: free text (e.g. "11:30 PM"), nullable,
-- no format constraint, so it stays consistent with the existing column and
-- imposes nothing on rows created before this column existed.
--
-- No external credentials are required to apply.
-- =========================================================

alter table public.events
  add column if not exists event_end_time text;
