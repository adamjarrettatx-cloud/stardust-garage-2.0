-- Financial Write-Up: one saved post-event settlement worksheet per event.
--
-- Online (sdgatx.com) figures are always computed live from orders; only the
-- values Adam types in are stored here: door gross from the POS dashboard,
-- the organizer's percentage of net ticket revenue, and itemized
-- adjustments (positive = paid to the organizer, negative = charged to them).
-- Rates are stored per event so a later rate change never rewrites an
-- already-settled event.
--
-- Additive only. Admin-only via RLS; the app reads/writes with the service
-- role behind requireAdminMfa().

create table if not exists public.event_writeups (
  event_id uuid primary key references public.events(id) on delete cascade,
  door_gross_cents bigint check (door_gross_cents is null or door_gross_cents >= 0),
  door_tax_bps integer not null default 825 check (door_tax_bps between 0 and 10000),
  door_cc_fee_bps integer not null default 385 check (door_cc_fee_bps between 0 and 10000),
  stripe_pct_bps integer not null default 290 check (stripe_pct_bps between 0 and 10000),
  stripe_fixed_cents integer not null default 30 check (stripe_fixed_cents between 0 and 1000),
  organizer_percent numeric(5,2) check (organizer_percent is null or (organizer_percent >= 0 and organizer_percent <= 100)),
  adjustments jsonb not null default '[]'::jsonb check (jsonb_typeof(adjustments) = 'array'),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.event_writeups enable row level security;

drop policy if exists event_writeups_admin_all on public.event_writeups;
create policy event_writeups_admin_all
  on public.event_writeups
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.event_writeups from anon;
