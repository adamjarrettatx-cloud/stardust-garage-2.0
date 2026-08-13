-- Artist / DJ Pay System — Phase 2: event pay assignment.
--
-- event_bookings is the "who's playing, when, for how much" record: an admin
-- adds one or more artists to an event, each with their own time slot and pay
-- rate (hourly or flat). This is the thing Phase 3's Request Pay / Review & Pay
-- flow will act on, and the thing artist_pay_requests will snapshot an amount
-- from — so the status enum below already includes the later-phase states
-- (pay_requested, in_review, paid, rejected) even though nothing in this
-- migration can produce them yet, the same way documents.category was widened
-- ahead of the UI that uses 'tax' in 20260812_artist_contact_tax_profiles.sql.
-- Avoids a second ALTER TABLE in Phase 3 just to add states we already know
-- are coming.
--
-- Mirrors the event_guestlist_grants / guestlist_audit_log shape from
-- 20260729_guest_list_partners.sql: a data table + an append-only audit log,
-- RLS split between "admin writes, team reads, partner sees only their own
-- rows" — reusing public.is_admin() / public.is_team() / public.partner_contact_id()
-- from that migration rather than redefining them.
--
-- No banking/Mercury fields here — those live in a future partner_payout_accounts
-- table (Phase 4), kept deliberately separate from pay assignment.

-- ---------------------------------------------------------------------------
-- 1. event_bookings
-- ---------------------------------------------------------------------------
create table if not exists public.event_bookings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  -- The artist. Not required to be a dj/artist/performer contact_type at the
  -- DB level (a CHECK can't see another table) — the API route enforces that
  -- with lib/contact-helpers.js's isContractorContact() before insert.
  contact_id uuid not null references public.contacts(id) on delete cascade,
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  pay_type text not null check (pay_type in ('hourly', 'flat')),
  hourly_rate_cents integer check (hourly_rate_cents > 0),
  flat_amount_cents integer check (flat_amount_cents > 0),
  status text not null default 'scheduled' check (status in (
    'scheduled',      -- created, slot hasn't happened yet (or has, but the
                       -- Phase 3 cron hasn't flipped it to completed yet)
    'completed',      -- slot_end + 15min has passed; Request Pay can appear
                       -- (Phase 3 cron sets this — nothing in Phase 2 does)
    'pay_requested',  -- artist tapped Request Pay (Phase 3)
    'in_review',      -- admin opened Review & Pay (Phase 3)
    'paid',           -- Mercury transfer completed (Phase 4)
    'rejected',       -- admin rejected the pay request; needs manual reopen
                       -- per the plan's 3.3.1 (Phase 3)
    'cancelled'       -- booking called off before any pay activity
  )),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_bookings_slot_order check (slot_end > slot_start),
  -- Exactly one of the two rate columns is set, matching pay_type — the same
  -- rule the technical plan's event_bookings spec calls for.
  constraint event_bookings_pay_amount_check check (
    (pay_type = 'hourly' and hourly_rate_cents is not null and flat_amount_cents is null)
    or
    (pay_type = 'flat' and flat_amount_cents is not null and hourly_rate_cents is null)
  )
);

create index if not exists event_bookings_event_id_idx   on public.event_bookings(event_id);
create index if not exists event_bookings_contact_id_idx on public.event_bookings(contact_id);
create index if not exists event_bookings_status_idx     on public.event_bookings(status);

-- ---------------------------------------------------------------------------
-- 2. booking_audit_log — append-only history, mirroring guestlist_audit_log.
--
-- Only the three actions Phase 2 can actually produce are allowed today.
-- Phase 3 will widen this the same way this migration widened
-- documents.category — add 'pay_requested' / 'pay_reviewed' / 'pay_rejected' /
-- 'pay_reopened' / 'pay_paid' etc. to the check constraint when that code
-- ships, rather than guessing the full list now.
-- ---------------------------------------------------------------------------
create table if not exists public.booking_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in (
    'booking_created', 'booking_updated', 'booking_cancelled'
  )),
  booking_id uuid references public.event_bookings(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  ip_address text,
  user_agent text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists booking_audit_log_booking_id_idx on public.booking_audit_log(booking_id);
create index if not exists booking_audit_log_created_at_idx on public.booking_audit_log(created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at bookkeeping, same per-table trigger pattern as the rest of the
-- codebase (event_guestlist_grants_set_updated, contact_tax_profiles_set_updated).
-- ---------------------------------------------------------------------------
create or replace function public.event_bookings_set_updated()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists event_bookings_set_updated_trg on public.event_bookings;
create trigger event_bookings_set_updated_trg
before update on public.event_bookings
for each row execute function public.event_bookings_set_updated();

-- ---------------------------------------------------------------------------
-- RLS — event_bookings
--
-- Writes are admin-only (this sets pay rates), reads are team-wide, and a
-- partner can see their own booking rows so Phase 3's artist-side "my
-- schedule" / Request Pay UI doesn't need a second migration to add this
-- read policy later. Mirrors "Partners can view their own grants" on
-- event_guestlist_grants.
-- ---------------------------------------------------------------------------
alter table public.event_bookings enable row level security;

drop policy if exists "Partners can view their own bookings" on public.event_bookings;
create policy "Partners can view their own bookings" on public.event_bookings
  for select to authenticated
  using (contact_id = public.partner_contact_id());

drop policy if exists "Team can view all bookings" on public.event_bookings;
create policy "Team can view all bookings" on public.event_bookings
  for select to authenticated
  using (public.is_team());

drop policy if exists "Admins can insert bookings" on public.event_bookings;
create policy "Admins can insert bookings" on public.event_bookings
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Admins can update bookings" on public.event_bookings;
create policy "Admins can update bookings" on public.event_bookings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can delete bookings" on public.event_bookings;
create policy "Admins can delete bookings" on public.event_bookings
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- RLS — booking_audit_log (team-readable, team-insertable — same shape as
-- guestlist_audit_log; the actual writes always come from the service-role
-- key inside a requireAdminMfa()-gated route, this is just the backstop).
-- ---------------------------------------------------------------------------
alter table public.booking_audit_log enable row level security;

drop policy if exists "Team can view booking audit log" on public.booking_audit_log;
create policy "Team can view booking audit log" on public.booking_audit_log
  for select to authenticated
  using (public.is_team());

drop policy if exists "Team can insert booking audit rows" on public.booking_audit_log;
create policy "Team can insert booking audit rows" on public.booking_audit_log
  for insert to authenticated
  with check (public.is_team());
