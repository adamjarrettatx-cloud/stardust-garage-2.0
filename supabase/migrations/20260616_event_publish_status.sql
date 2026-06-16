-- =========================================================
-- Event Publish Status  (additive — safe to apply)
--
-- This migration is PURELY ADDITIVE:
--   * adds one nullable-with-default column (public.events.status)
--   * adds a supporting index
-- It does NOT alter or drop any existing column or policy, and it does
-- NOT change any data: every existing row defaults to 'published', so the
-- public events page keeps showing exactly what it shows today.
--
-- Purpose: support the "create as draft, publish later" workflow for events
-- created through the Stardust admin together with a TicketTailor draft event
-- series. A draft event is hidden from the public /events page; publishing it
-- (and its TicketTailor event series) flips it to 'published'.
--
-- DEFAULT 'published' is deliberate: the column is new, so all pre-existing
-- events must remain visible. Only NEW events created via the TicketTailor
-- create flow are inserted with status='draft'.
--
-- No external credentials are required to apply.
-- =========================================================

alter table public.events
  add column if not exists status text not null default 'published'
    check (status in ('draft', 'published'));

create index if not exists events_status_idx on public.events(status);
