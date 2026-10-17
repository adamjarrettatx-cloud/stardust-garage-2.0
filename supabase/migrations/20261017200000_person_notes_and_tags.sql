-- Person Profile: private staff notes and tags on a customer (Guest, Trial,
-- Member or Applicant). Rows carry every identity key the person had when
-- written (user:, member:, trial_pass:, guest:, application:) and are read
-- back by key overlap, so they follow the person across lifecycle stages.
--
-- Access is server-only: the admin API routes use the service role after
-- requireAdminMfa. Browsers (anon/authenticated) get no direct access.

create table if not exists public.person_notes (
  id uuid primary key default gen_random_uuid(),
  anchor_key text not null
    check (anchor_key ~ '^(user|member|trial_pass|guest|application):[0-9a-f-]{36}$'),
  identity_keys text[] not null
    check (cardinality(identity_keys) between 1 and 200),
  author_id uuid references auth.users(id) on delete set null,
  author_name text,
  author_email text,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null
);

create index if not exists person_notes_identity_keys_idx
  on public.person_notes using gin (identity_keys) where deleted_at is null;

create table if not exists public.person_tags (
  id uuid primary key default gen_random_uuid(),
  anchor_key text not null
    check (anchor_key ~ '^(user|member|trial_pass|guest|application):[0-9a-f-]{36}$'),
  identity_keys text[] not null
    check (cardinality(identity_keys) between 1 and 200),
  label text not null check (char_length(btrim(label)) between 1 and 32),
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users(id) on delete set null
);

create index if not exists person_tags_identity_keys_idx
  on public.person_tags using gin (identity_keys) where removed_at is null;
create unique index if not exists person_tags_anchor_label_active_uniq
  on public.person_tags (anchor_key, lower(btrim(label))) where removed_at is null;

alter table public.person_notes enable row level security;
alter table public.person_tags enable row level security;

revoke all on public.person_notes from anon, authenticated;
revoke all on public.person_tags from anon, authenticated;
