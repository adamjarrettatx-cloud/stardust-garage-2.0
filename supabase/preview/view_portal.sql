-- ISOLATED PREVIEW DATABASE ONLY. Not part of production migrations.
-- Run after a verified schema-only baseline and the application's migrations.
create table public.view_portal_personas (
  persona_id text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  fixture_version integer not null default 1,
  ready boolean not null default false
);
create table public.view_portal_redemptions (
  nonce uuid primary key,
  owner_id uuid not null,
  persona_id text not null references public.view_portal_personas(persona_id),
  created_at timestamptz not null default now()
);
alter table public.view_portal_personas enable row level security;
alter table public.view_portal_redemptions enable row level security;
revoke all on public.view_portal_personas, public.view_portal_redemptions from anon, authenticated;
grant all on public.view_portal_personas, public.view_portal_redemptions to service_role;
-- No authenticated policies: admin preview identities cannot alter the registry,
-- read launch audit records, or replay redeemed launch tokens through PostgREST.
