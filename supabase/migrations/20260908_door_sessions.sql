-- Door Sessions — the "shift" that binds every door scan to a specific event.
--
-- Before this table, the /scan page kept its selected event in localStorage.
-- That works, but it has three problems:
--
--   1. Ambiguity on late-night events. A show that starts Fri 10pm and runs
--      until Sat 2am has no clean "today" answer at 1am.
--   2. Ambiguity on double-header days. Day party + night show would need a
--      manual event-switch mid-day with no audit trail.
--   3. No per-shift analytics. "How many people did we scan between doors
--      open and last call?" is unanswerable from a bag of scans.
--
-- A door session models the door-person's *shift*: they tap Start Event when
-- doors open, the system opens a session bound to that event, all subsequent
-- scans are bound to that session, and tapping End Event closes it. Only ONE
-- session may be open at a time across the whole venue (enforced by the
-- partial unique index below). This is a soft global-lock — if you truly run
-- two doors simultaneously, we'll revisit, but the physical reality is one
-- front door.
--
-- Every scan audit row (trial_pass_checkins, ticket_checkins, member_id_scans)
-- gets an optional door_session_id in a companion migration. Old scans (pre-
-- rollout) have null; new scans made outside an open session (e.g. off-hours
-- test scans) also have null. NULL is intentional: it means "no shift".
--
-- Team gate: only team_members (role team or admin) may open / close a
-- session. Enforced at the API layer via requireTeam(); RLS below is locked
-- so no direct client access.

create table if not exists public.door_sessions (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete restrict,
  opened_at     timestamptz not null default now(),
  opened_by     uuid not null,          -- auth.users.id of the staff member
  closed_at     timestamptz,
  closed_by     uuid,                   -- auth.users.id of who tapped End Event
  notes         text,                   -- optional free-text (e.g. "raining, slow start")
  constraint door_sessions_close_pair check (
    (closed_at is null and closed_by is null)
    or (closed_at is not null and closed_by is not null)
  ),
  constraint door_sessions_close_after_open check (
    closed_at is null or closed_at >= opened_at
  )
);

-- Only one open session at a time across the venue.
create unique index if not exists door_sessions_one_open_at_a_time
  on public.door_sessions ((true))
  where closed_at is null;

create index if not exists door_sessions_event_idx
  on public.door_sessions (event_id, opened_at desc);

create index if not exists door_sessions_opened_by_idx
  on public.door_sessions (opened_by, opened_at desc);

alter table public.door_sessions enable row level security;
revoke all on public.door_sessions from anon, authenticated;

comment on table public.door_sessions is
  'One row per door shift. Opened when staff taps Start Event on /scan, closed on End Event. All scans within the open window get door_session_id stamped for per-shift analytics.';
