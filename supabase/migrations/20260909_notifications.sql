-- Notifications system \u2014 Phase 1 (in-app feed + email fanout)
--
-- Two tables:
--
--   notifications              per-user feed, ONE row per delivered
--                              notification. This is the source of truth
--                              behind the bell icon and /portal/notifications
--                              feed page. A row is written even when the user
--                              has opted out of email/push \u2014 the in-app feed
--                              is always on so the user can catch up on
--                              anything they missed.
--
--   notification_preferences   (user_id, type) \u2014 per-user, per-type channel
--                              toggles. When absent for a (user, type) pair
--                              we fall back to the type's defaults from
--                              lib/notifications/types.js. So a brand-new
--                              user is opted-in-by-default to everything
--                              per their defaults; opt-outs are stored
--                              explicitly.
--
-- Push tokens table deliberately NOT created here \u2014 will be added in Phase 2
-- when the mobile app is on TestFlight and can register tokens. The sender
-- has a stub for push that becomes real then; the DB shape doesn't have to
-- change to add it.
--
-- RLS: revoke everything from anon/authenticated and gate all reads/writes
-- through server routes with the service-role admin client, matching the
-- pattern used everywhere else in this repo (member_id_scans,
-- trial_pass_checkins, etc.).

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  type         text not null,
  title        text not null,
  body         text,
  data         jsonb not null default '{}'::jsonb,
  read_at      timestamptz,
  channels_sent text[] not null default array[]::text[],
  created_at   timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

create index if not exists notifications_type_created_idx
  on public.notifications (type, created_at desc);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;

comment on table public.notifications is
  'Per-user notification feed. One row per delivered notification. Powers the bell icon + /portal/notifications feed. Always written regardless of email/push opt-out.';

-- ---------------------------------------------------------------------------
-- notification_preferences
-- ---------------------------------------------------------------------------

create table if not exists public.notification_preferences (
  user_id      uuid not null references auth.users(id) on delete cascade,
  type         text not null,
  in_app       boolean not null default true,
  push         boolean not null default true,
  email        boolean not null default true,
  updated_at   timestamptz not null default now(),
  primary key (user_id, type)
);

create index if not exists notification_preferences_user_idx
  on public.notification_preferences (user_id);

alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon, authenticated;

comment on table public.notification_preferences is
  'Per-user per-type channel toggles. Absence of a row means \"use type defaults\" (opt-in-by-default). Explicit rows record opt-outs. in_app currently always effective; push respected in Phase 2 once mobile app can register tokens.';
