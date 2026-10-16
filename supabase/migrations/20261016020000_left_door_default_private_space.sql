-- The Left Door is a permanent private-space add-on on every event
-- (owner's rule, 2026-10-15).
--
--   * Every new event automatically gets one "The Left Door" private-space
--     product with the default photo and description.
--   * It has NO price tier when created, so it cannot be sold until an admin
--     sets that event's price (no accidental $0 / stale-price sales).
--   * Exactly one room per event: inventory capacity 1, one per order.
--   * "Don't sell" = is_active false (hidden from buyers, reversible; the
--     photo, description and price are kept).
--   * system_key = 'left_door' identifies the permanent row; at most one per
--     event.
--   * Upcoming events (today or later, Austin time) that do not already have
--     a Left Door listing receive one now.

alter table public.ticket_products
  add column if not exists system_key text;

alter table public.ticket_products
  drop constraint if exists ticket_products_system_key_check;

alter table public.ticket_products
  add constraint ticket_products_system_key_check
  check (system_key is null or (system_key = 'left_door' and kind = 'private_space'));

create unique index if not exists ticket_products_one_left_door_per_event
  on public.ticket_products (event_id)
  where system_key = 'left_door';

comment on column public.ticket_products.system_key is
  'left_door = the permanent per-event Left Door private space (created automatically, one per event).';

-- Creates the Left Door row (and its capacity-1 inventory row) for one event.
-- Idempotent: does nothing if the event already has one.
create or replace function public.ensure_left_door_private_space(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
begin
  if exists (
    select 1 from public.ticket_products
     where event_id = p_event_id and system_key = 'left_door'
  ) then
    return;
  end if;

  insert into public.ticket_products (
    event_id, name, description, kind, system_key, image_url,
    member_only, min_per_order, max_per_order, is_active,
    display_order, tier_reveal_threshold
  ) values (
    p_event_id,
    'The Left Door',
    'Upstairs Green Room / Vip Room (ask staff to tour the space if you are interested before purchasing). Requires a minimum of 2 people to 10 people max in the room.',
    'private_space',
    'left_door',
    'https://auth.sdgatx.com/storage/v1/object/public/event-images/1791591824753-44444444.jpg',
    false, 1, 1, true,
    0, 10
  )
  on conflict (event_id) where system_key = 'left_door' do nothing
  returning id into v_product_id;

  if v_product_id is not null then
    insert into public.ticket_inventory (product_id, capacity, sold, reserved)
    values (v_product_id, 1, 0, 0)
    on conflict (product_id) do nothing;
  end if;
end;
$$;

revoke all on function public.ensure_left_door_private_space(uuid) from public;
revoke all on function public.ensure_left_door_private_space(uuid) from anon, authenticated;
grant execute on function public.ensure_left_door_private_space(uuid) to service_role;

create or replace function public.events_add_left_door()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_left_door_private_space(new.id);
  return new;
end;
$$;

revoke all on function public.events_add_left_door() from public;
revoke all on function public.events_add_left_door() from anon, authenticated;

drop trigger if exists events_add_left_door on public.events;
create trigger events_add_left_door
  after insert on public.events
  for each row execute function public.events_add_left_door();

-- Backfill: upcoming events without any Left Door listing. An existing
-- private space already named "The Left Door" is adopted as the permanent row
-- (keeping its price, photo and description) instead of adding a second one.
update public.ticket_products p
   set system_key = 'left_door', updated_at = now()
  from public.events e
 where e.id = p.event_id
   and e.event_date >= (now() at time zone 'America/Chicago')::date
   and p.kind = 'private_space'
   and p.system_key is null
   and lower(trim(p.name)) = 'the left door'
   and p.id = (
     select p2.id from public.ticket_products p2
      where p2.event_id = p.event_id
        and p2.kind = 'private_space'
        and lower(trim(p2.name)) = 'the left door'
      order by p2.is_active desc, p2.created_at asc
      limit 1
   )
   and not exists (
     select 1 from public.ticket_products p3
      where p3.event_id = p.event_id and p3.system_key = 'left_door'
   );

do $$
declare
  r record;
begin
  for r in
    select e.id
      from public.events e
     where e.event_date >= (now() at time zone 'America/Chicago')::date
  loop
    perform public.ensure_left_door_private_space(r.id);
  end loop;
end;
$$;
