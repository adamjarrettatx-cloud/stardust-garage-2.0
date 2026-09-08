-- Add door_session_id to every scan-audit table.
--
-- Every /scan API (trial-pass, ticket, member-id) accepts an optional
-- door_session_id in its request body. When present and non-null, we stamp
-- it onto the resulting audit row so that later analytics can answer:
--
--   * how many scans in this shift?
--   * scans per minute during peak?
--   * which staff member ran the door for this event?
--   * average time between scans in the first hour vs the last?
--
-- Backwards compatible: NULL means "no shift was open" (legacy rows and
-- off-shift test scans). Nothing gates on this column — it is purely for
-- audit and analytics.

alter table public.trial_pass_checkins
  add column if not exists door_session_id uuid references public.door_sessions(id) on delete set null;

alter table public.ticket_checkins
  add column if not exists door_session_id uuid references public.door_sessions(id) on delete set null;

alter table public.member_id_scans
  add column if not exists door_session_id uuid references public.door_sessions(id) on delete set null;

create index if not exists trial_pass_checkins_door_session_idx
  on public.trial_pass_checkins (door_session_id)
  where door_session_id is not null;

create index if not exists ticket_checkins_door_session_idx
  on public.ticket_checkins (door_session_id)
  where door_session_id is not null;

create index if not exists member_id_scans_door_session_idx
  on public.member_id_scans (door_session_id)
  where door_session_id is not null;

comment on column public.trial_pass_checkins.door_session_id is 'The door shift this scan happened in. NULL if no shift was open. Pure audit.';
comment on column public.ticket_checkins.door_session_id is 'The door shift this scan happened in. NULL if no shift was open. Pure audit.';
comment on column public.member_id_scans.door_session_id is 'The door shift this scan happened in. NULL if no shift was open. Pure audit.';
