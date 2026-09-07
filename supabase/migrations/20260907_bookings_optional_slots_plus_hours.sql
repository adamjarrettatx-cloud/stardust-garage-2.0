-- Artist Lineup: replace mandatory slot_start/slot_end with an optional
-- "hours_worked" number. Slot times were originally required so an hourly
-- rate could be turned into a total, but in practice admins already know
-- the hours a DJ played and don't want to fill datetime pickers for every
-- lineup entry. This makes slot times optional (kept for compatibility +
-- calendar use down the road) and gives us a direct hours field.
--
-- All existing rows have slot_start/slot_end already, so they satisfy the
-- new "either times or hours" check unchanged. hours_worked defaults to
-- null and the amount calculation prefers it when set, falling back to
-- the slot delta.

-- 1. New hours_worked column, nullable, must be > 0 when present.
alter table public.event_bookings
  add column if not exists hours_worked numeric(6,2)
    check (hours_worked is null or hours_worked > 0);

-- 2. Slot times become optional.
alter table public.event_bookings alter column slot_start drop not null;
alter table public.event_bookings alter column slot_end   drop not null;

-- 3. Old "slot_end must be strictly after slot_start" only makes sense when
-- both are present. Drop and re-add as a conditional.
alter table public.event_bookings drop constraint if exists event_bookings_slot_order;
alter table public.event_bookings
  add constraint event_bookings_slot_order
  check (slot_start is null or slot_end is null or slot_end > slot_start);

-- 4. Hourly bookings still need SOMETHING to compute their pay: either
-- slot times or hours_worked. Flat bookings don't need either.
alter table public.event_bookings drop constraint if exists event_bookings_pay_time_check;
alter table public.event_bookings
  add constraint event_bookings_pay_time_check check (
    pay_type <> 'hourly'
    or hours_worked is not null
    or (slot_start is not null and slot_end is not null)
  );

-- 5. partner_bookings() RPC prefers hours_worked when set. Order by
-- coalesced slot time so bookings without slot times sort by event date
-- instead of nulls-first/last surprising the portal.
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
      when b.hours_worked is not null then round(b.hourly_rate_cents * b.hours_worked)::integer
      when b.slot_start is not null and b.slot_end is not null
        then round(b.hourly_rate_cents * (extract(epoch from (b.slot_end - b.slot_start)) / 3600.0))::integer
      else null
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
  order by coalesce(b.slot_start, e.event_date::timestamptz) desc;
$$;
revoke all on function public.partner_bookings() from public;
grant execute on function public.partner_bookings() to authenticated;
