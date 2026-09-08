-- 20260907_waiver_gate.sql
-- Ticket-purchase liability waiver: version registry + per-transaction acceptance log.
-- Additive migration, safe on a live database.

-- ---------------------------------------------------------------------------
-- waiver_versions
-- Immutable registry of every version of the ticket waiver ever displayed.
-- Rows are never updated after insert; a text change creates a NEW row.
-- ---------------------------------------------------------------------------
create table if not exists public.waiver_versions (
  id                bigserial primary key,
  slug              text        not null,                         -- 'ticket_v1', 'ticket_v2', ...
  version           text        not null,                         -- '1.0', '1.1', '2.0'
  kind              text        not null default 'ticket',        -- future: 'membership', 'venue_rental'
  effective_at      timestamptz not null default now(),
  checkbox_label    text        not null,                         -- exact label shown next to the box
  body_markdown     text        not null,                         -- full waiver body as shown
  body_sha256       text        not null,                         -- sha256 hex of body_markdown, uppercase
  is_active         boolean     not null default true,            -- only one active row per kind at a time
  created_at        timestamptz not null default now(),
  constraint waiver_versions_slug_unique unique (slug),
  constraint waiver_versions_sha_len check (char_length(body_sha256) = 64)
);

create unique index if not exists waiver_versions_active_per_kind
  on public.waiver_versions (kind)
  where is_active;

-- ---------------------------------------------------------------------------
-- waiver_acceptances
-- One row per transaction acceptance. Immutable after insert.
-- Linked to an order (internal) OR a TicketTailor order id OR a comp/RSVP.
-- ---------------------------------------------------------------------------
create table if not exists public.waiver_acceptances (
  id                    bigserial   primary key,
  waiver_version_id     bigint      not null references public.waiver_versions(id),
  waiver_slug           text        not null,      -- denormalized for fast filtering
  waiver_body_sha256    text        not null,      -- snapshot of the hash at accept time

  -- who
  user_id               uuid        references auth.users(id),   -- null for guest checkouts
  buyer_email           text,                                    -- normalized lowercase
  buyer_name            text,

  -- what transaction
  source                text        not null,      -- 'internal_ticket' | 'tickettailor' | 'admin_comp' | 'rsvp' | 'wallet_setup'
  order_id              uuid        references public.orders(id) on delete set null,
  tickettailor_order_id text,
  event_id              uuid        references public.events(id) on delete set null,
  hold_id               uuid        references public.ticket_holds(id) on delete set null,  -- pre-payment linkage
  external_ref          text,                       -- catch-all: comp_ref, rsvp id, etc.

  -- evidence
  accepted_at           timestamptz not null default now(),
  ip_address            inet,
  user_agent            text,
  page_url              text,
  request_id            text,                       -- Vercel x-vercel-id for cross-log correlation

  -- retention control (soft-cap: cron never deletes rows younger than this)
  retain_until          timestamptz not null default (now() + interval '4 years'),

  created_at            timestamptz not null default now()
);

create index if not exists waiver_acceptances_order_id_idx
  on public.waiver_acceptances (order_id);
create index if not exists waiver_acceptances_email_idx
  on public.waiver_acceptances (buyer_email);
create index if not exists waiver_acceptances_user_id_idx
  on public.waiver_acceptances (user_id);
create index if not exists waiver_acceptances_event_id_idx
  on public.waiver_acceptances (event_id);
create index if not exists waiver_acceptances_accepted_at_idx
  on public.waiver_acceptances (accepted_at desc);
create index if not exists waiver_acceptances_hold_id_idx
  on public.waiver_acceptances (hold_id) where hold_id is not null;
create index if not exists waiver_acceptances_tt_order_idx
  on public.waiver_acceptances (tickettailor_order_id) where tickettailor_order_id is not null;

-- Immutability: no updates, no deletes (except by superuser for retention sweeps)
create or replace function public.waiver_acceptances_no_mutate()
returns trigger language plpgsql as $$
begin
  raise exception 'waiver_acceptances rows are immutable';
end$$;

drop trigger if exists waiver_acceptances_block_update on public.waiver_acceptances;
create trigger waiver_acceptances_block_update
  before update on public.waiver_acceptances
  for each row execute function public.waiver_acceptances_no_mutate();

drop trigger if exists waiver_acceptances_block_delete on public.waiver_acceptances;
create trigger waiver_acceptances_block_delete
  before delete on public.waiver_acceptances
  for each row execute function public.waiver_acceptances_no_mutate();

-- Same for waiver_versions
create or replace function public.waiver_versions_no_mutate_body()
returns trigger language plpgsql as $$
begin
  if new.body_markdown is distinct from old.body_markdown
     or new.body_sha256 is distinct from old.body_sha256
     or new.checkbox_label is distinct from old.checkbox_label
     or new.version is distinct from old.version
     or new.slug is distinct from old.slug then
    raise exception 'waiver_versions body/version fields are immutable; bump slug/version instead';
  end if;
  return new;
end$$;

drop trigger if exists waiver_versions_immutable_body on public.waiver_versions;
create trigger waiver_versions_immutable_body
  before update on public.waiver_versions
  for each row execute function public.waiver_versions_no_mutate_body();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.waiver_versions   enable row level security;
alter table public.waiver_acceptances enable row level security;

-- waiver_versions: anyone (including anon checkout) can read active rows.
drop policy if exists waiver_versions_public_read on public.waiver_versions;
create policy waiver_versions_public_read
  on public.waiver_versions
  for select
  using (is_active = true);

-- Admin writes handled by service-role only; no anon INSERT/UPDATE/DELETE.

-- waiver_acceptances: no client reads. Service role only for writes and reads.
-- (Admin UI hits a server route that uses service-role, matching existing
-- admin ticketing pattern.)
-- Members can read their own acceptances (matches orders RLS pattern).
drop policy if exists waiver_acceptances_owner_read on public.waiver_acceptances;
create policy waiver_acceptances_owner_read
  on public.waiver_acceptances
  for select
  using (
    (auth.uid() is not null and user_id = auth.uid())
    or (
      buyer_email is not null
      and lower(buyer_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

-- No client INSERT/UPDATE/DELETE. All writes go through service-role from
-- server routes (hold/webhook/comp/rsvp/wallet-setup).

-- ---------------------------------------------------------------------------
-- Seed the active v1.0 waiver.
-- body_markdown is inserted verbatim; body_sha256 must match the hash
-- computed by lib/waiver/versions.js at build time. The seed here is a
-- placeholder; the deploy step below (see plan doc) inserts the real
-- verbatim text + hash using the CLI seed script.
-- ---------------------------------------------------------------------------
-- (Seed is done in a separate script so the body text lives in one place
--  in code (lib/waiver/versions.js) and is inserted by
--  scripts/seed-waiver.mjs, keeping this migration deterministic and
--  environment-agnostic.)
