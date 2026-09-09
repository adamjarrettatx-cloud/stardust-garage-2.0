-- Durable idempotency and audit records for admin notification fanout.
create table if not exists public.notification_broadcasts (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid unique not null,
  admin_user_id uuid not null references auth.users(id),
  audience text not null,
  subject text not null,
  body text not null,
  sent_count integer,
  created_at timestamptz not null default now()
);

alter table public.notification_broadcasts enable row level security;
revoke all on public.notification_broadcasts from anon, authenticated;

-- Used by tt-publish to stop replayed publish requests within a short window.
alter table public.events add column if not exists tt_last_published_at timestamptz;
