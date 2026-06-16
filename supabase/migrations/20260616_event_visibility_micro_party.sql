-- =========================================================
-- Event Visibility + Micro Party type  (additive — safe to apply)
--
-- This migration is PURELY ADDITIVE:
--   * adds two nullable-with-default columns on public.events:
--       - visibility  text  default 'public'  ('public' | 'internal')
--       - event_type  text  default 'standard' ('standard' | 'micro_party')
--   * adds supporting indexes
-- It does NOT alter or drop any existing column or policy, and it does NOT
-- change any data: every existing row defaults to visibility='public' and
-- event_type='standard', so the public /events page and the member-facing
-- surfaces keep showing exactly what they show today.
--
-- Purpose: support internal-only "micro party" events. These are real events
-- (they carry contracts, SignNow flows, financials, and optional POS imports)
-- but are known only internally. They appear on the admin/team calendar and in
-- the admin dashboard, and are explicitly EXCLUDED from the public /events
-- list, the public /events/[slug] detail page, and any member-facing event
-- surface — exactly the way draft events are excluded today, by filtering at
-- the query level (visibility = 'public').
--
-- DEFAULT 'public' is deliberate: the column is new, so all pre-existing
-- events must remain visible to the public. Only events an admin explicitly
-- marks as a micro party are inserted/updated with visibility='internal'.
--
-- 'micro_party' is the only internal event type today. visibility is the
-- access control; event_type is a label so future internal types can be added
-- without another migration. They are independent on purpose: an event could
-- be internal without being a micro party, and the public filter keys on
-- visibility alone.
--
-- No external credentials are required to apply.
-- =========================================================

alter table public.events
  add column if not exists visibility text not null default 'public'
    check (visibility in ('public', 'internal'));

alter table public.events
  add column if not exists event_type text not null default 'standard'
    check (event_type in ('standard', 'micro_party'));

create index if not exists events_visibility_idx on public.events(visibility);
create index if not exists events_event_type_idx on public.events(event_type);
