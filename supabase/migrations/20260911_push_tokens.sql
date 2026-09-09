-- The mobile client's Expo push token store. The table predates this migration
-- in production, so every change below is safe to apply to either database
-- state without dropping a token or a column.

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android', 'web')),
  device_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_tokens
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists token text,
  add column if not exists platform text,
  add column if not exists device_label text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Legacy registrations predate the platform requirement. Expo's iOS token
-- format is the safest legacy default; future registrations always provide it.
update public.push_tokens
  set platform = 'ios'
  where platform is null;

alter table public.push_tokens
  alter column platform set not null;

-- One row per (user, token). Mobile upserts on this key, so a re-registration
-- updates its timestamp instead of accumulating duplicate deliveries.
create unique index if not exists push_tokens_user_token_uk
  on public.push_tokens (user_id, token);

-- Fast fanout lookup by user.
create index if not exists push_tokens_user_idx
  on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

-- Replace the old broad ALL policy with individual policies so the mobile
-- client may manage only its own registrations.
drop policy if exists "users manage their own push tokens" on public.push_tokens;
drop policy if exists push_tokens_own_read on public.push_tokens;
create policy push_tokens_own_read on public.push_tokens
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists push_tokens_own_insert on public.push_tokens;
create policy push_tokens_own_insert on public.push_tokens
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists push_tokens_own_update on public.push_tokens;
create policy push_tokens_own_update on public.push_tokens
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists push_tokens_own_delete on public.push_tokens;
create policy push_tokens_own_delete on public.push_tokens
  for delete to authenticated
  using (user_id = auth.uid());
