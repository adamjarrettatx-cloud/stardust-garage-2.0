-- Artist / DJ Pay System — Phase 3: Request Pay + Review & Pay.
--
-- Adds the artist-initiated "Request Pay" action and the admin-side
-- "Review & Pay" approve/reject/reopen flow on top of Phase 2's
-- event_bookings. Mirrors the event_guestlist_grants / guestlist_audit_log
-- shape again: a data table + an append-only audit log, RLS split between
-- "team reads everything, partner sees only their own rows" — but with one
-- deliberate difference from Phase 2's event_bookings policies: there is NO
-- authenticated insert/update/delete policy on artist_pay_requests at all.
-- Every write (request, approve, reject, reopen) goes through a service-role
-- route gated by requirePartner() or requireAdminMfa() — exactly the same
-- posture as partner_profiles.is_active, which "can only be flipped by the
-- service-role key... never by the partner or even an admin's direct table
-- write." This keeps the money-adjacent state machine impossible to skip via
-- a direct PostgREST call from the network tab.
--
-- Does NOT move any money. 'approved' means "cleared to pay" — Phase 4's
-- Mercury wiring is what will later transition approved -> paid.

-- ---------------------------------------------------------------------------
-- 1. Widen event_bookings.status to add 'approved'.
--
-- Phase 2 already included every later-phase state it could predict
-- (pay_requested, in_review, paid, rejected) except this one — Approve &
-- Pay needing its own booking-level state wasn't decided until Phase 3's
-- design pass. Same ALTER pattern as the tax-profile category widen this
-- migration's header references.
-- ---------------------------------------------------------------------------
alter table public.event_bookings drop constraint if exists event_bookings_status_check;
alter table public.event_bookings add constraint event_bookings_status_check check (status in (
  'scheduled',
  'completed',
  'pay_requested',
  'approved',
  'in_review',
  'paid',
  'rejected',
  'cancelled'
));

-- ---------------------------------------------------------------------------
-- 2. artist_pay_requests
--
-- One row per request attempt. Deliberately NOT a hard unique on booking_id —
-- a partial unique index (below) blocks a second *active* request while one
-- is pending_review or approved, but a reject -> admin reopen -> re-request
-- cycle creates a brand new row rather than mutating the rejected one. That
-- keeps the full history (including the rejection_reason from a prior round)
-- intact for the 1099 / audit trail instead of overwriting it.
--
-- contact_id and event_id are denormalized off the booking at request time
-- rather than always joined through booking_id: it's what lets
-- "Team can view all" and "Partner can view their own" stay simple
-- single-column RLS checks (no subquery through event_bookings needed), the
-- same shortcut event_guestlist_grants takes by storing contact_id directly
-- instead of requiring a join back to whatever it was granted for.
-- ---------------------------------------------------------------------------
create table if not exists public.artist_pay_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.event_bookings(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  -- Snapshot of the booking's pay shape at request time, so a later look at
  -- this row's amount never has to trust that the booking wasn't edited out
  -- from under it (editing is already blocked once a request is active — see
  -- bookingPayInProgress in lib/booking-helpers.js — but a snapshot means the
  -- 1099 total is correct even after a cascade delete of the event itself
  -- some day, and needs no live recomputation to display).
  pay_type text not null check (pay_type in ('hourly', 'flat')),
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending_review' check (status in (
    'pending_review',  -- artist just tapped Request Pay
    'approved',        -- admin approved — cleared to pay, no money moved yet
    'rejected'         -- admin rejected; needs an admin "Reopen for Payment"
                        -- on the booking before the artist can request again
  )),
  requested_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists artist_pay_requests_booking_id_idx on public.artist_pay_requests(booking_id);
create index if not exists artist_pay_requests_contact_id_idx on public.artist_pay_requests(contact_id);
create index if not exists artist_pay_requests_status_idx     on public.artist_pay_requests(status);

-- The "at most one active request per booking" rule described above.
create unique index if not exists artist_pay_requests_active_booking_idx
  on public.artist_pay_requests(booking_id)
  where status in ('pending_review', 'approved');

create or replace function public.artist_pay_requests_set_updated()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists artist_pay_requests_set_updated_trg on public.artist_pay_requests;
create trigger artist_pay_requests_set_updated_trg
before update on public.artist_pay_requests
for each row execute function public.artist_pay_requests_set_updated();

-- ---------------------------------------------------------------------------
-- 3. artist_pay_audit_log — append-only history, same shape as
-- booking_audit_log / guestlist_audit_log.
-- ---------------------------------------------------------------------------
create table if not exists public.artist_pay_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in (
    'pay_requested', 'pay_approved', 'pay_rejected', 'pay_reopened'
  )),
  request_id uuid references public.artist_pay_requests(id) on delete set null,
  booking_id uuid references public.event_bookings(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  ip_address text,
  user_agent text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists artist_pay_audit_log_request_id_idx on public.artist_pay_audit_log(request_id);
create index if not exists artist_pay_audit_log_booking_id_idx on public.artist_pay_audit_log(booking_id);
create index if not exists artist_pay_audit_log_created_at_idx on public.artist_pay_audit_log(created_at desc);

-- ---------------------------------------------------------------------------
-- 4. RLS — artist_pay_requests.
--
-- Reads only. No insert/update/delete policy for `authenticated` at all,
-- on purpose — see the header note. The service-role key used by the gated
-- API routes bypasses RLS entirely, which is the only way a row in this
-- table is ever written.
-- ---------------------------------------------------------------------------
alter table public.artist_pay_requests enable row level security;

drop policy if exists "Team can view all pay requests" on public.artist_pay_requests;
create policy "Team can view all pay requests" on public.artist_pay_requests
  for select to authenticated
  using (public.is_team());

drop policy if exists "Partners can view their own pay requests" on public.artist_pay_requests;
create policy "Partners can view their own pay requests" on public.artist_pay_requests
  for select to authenticated
  using (contact_id = public.partner_contact_id());

-- ---------------------------------------------------------------------------
-- 5. RLS — artist_pay_audit_log (team-readable/insertable backstop, same as
-- booking_audit_log; real writes come from the service-role key).
-- ---------------------------------------------------------------------------
alter table public.artist_pay_audit_log enable row level security;

drop policy if exists "Team can view pay audit log" on public.artist_pay_audit_log;
create policy "Team can view pay audit log" on public.artist_pay_audit_log
  for select to authenticated
  using (public.is_team());

drop policy if exists "Team can insert pay audit rows" on public.artist_pay_audit_log;
create policy "Team can insert pay audit rows" on public.artist_pay_audit_log
  for insert to authenticated
  with check (public.is_team());

-- ---------------------------------------------------------------------------
-- 6. partner_bookings() — the artist-side read, mirroring partner_grants().
--
-- A partner has no select policy on public.events (draft / internal-visibility
-- events aren't published yet, which is exactly when an artist is looking at
-- their own upcoming slot before the night is announced), so a direct join
-- from event_bookings to events would silently return a blank event name and
-- date for exactly the events an artist most needs to see. Definer function,
-- scoped the same safe way partner_grants() is: the only rows returned are
-- ones whose contact_id matches partner_contact_id(), which itself requires
-- an active partner session.
--
-- Also folds in the latest artist_pay_requests row (if any) per booking via a
-- lateral join, so the partner portal can render "Request Pay" / "Pending
-- review" / "Approved" / "Rejected: <reason>" without a second round trip.
-- amount_cents is computed here (not read off a stored column, since
-- event_bookings has none) using the same rounding rule as
-- computeBookingAmountCents() in lib/booking-helpers.js.
-- ---------------------------------------------------------------------------
create or replace function public.partner_bookings()
returns table (
  id uuid,
  event_id uuid,
  event_title text,
  event_date date,
  event_time text,
  slot_start timestamptz,
  slot_end timestamptz,
  pay_type text,
  hourly_rate_cents integer,
  flat_amount_cents integer,
  amount_cents integer,
  status text,
  pay_request_id uuid,
  pay_request_status text,
  rejection_reason text
)
language sql stable security definer
set search_path = public, auth
as $$
  select
    b.id,
    b.event_id,
    e.title,
    e.event_date,
    e.event_time,
    b.slot_start,
    b.slot_end,
    b.pay_type,
    b.hourly_rate_cents,
    b.flat_amount_cents,
    case
      when b.pay_type = 'flat' then b.flat_amount_cents
      else round(b.hourly_rate_cents * (extract(epoch from (b.slot_end - b.slot_start)) / 3600.0))::integer
    end,
    b.status,
    pr.id,
    pr.status,
    pr.rejection_reason
  from public.event_bookings b
  join public.events e on e.id = b.event_id
  left join lateral (
    select apr.id, apr.status, apr.rejection_reason
    from public.artist_pay_requests apr
    where apr.booking_id = b.id
    order by apr.created_at desc
    limit 1
  ) pr on true
  where b.contact_id = public.partner_contact_id()
  order by b.slot_start desc;
$$;
revoke all on function public.partner_bookings() from public;
grant execute on function public.partner_bookings() to authenticated;
