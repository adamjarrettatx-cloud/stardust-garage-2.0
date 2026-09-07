-- Per-tier quantity + inventory tracking.
-- Each price tier gets its own optional capacity (NULL = unlimited) plus
-- sold_count/reserved_count counters. The existing per-product
-- ticket_inventory rows stay in place as a rollup so old code paths keep
-- working, but the authoritative sold-out signal is now per tier.

alter table public.ticket_price_tiers
  add column if not exists quantity integer,
  add column if not exists sold_count integer not null default 0,
  add column if not exists reserved_count integer not null default 0;

alter table public.ticket_price_tiers
  drop constraint if exists ticket_price_tiers_quantity_non_negative;
alter table public.ticket_price_tiers
  add constraint ticket_price_tiers_quantity_non_negative
  check (quantity is null or quantity >= 0);

create index if not exists ticket_price_tiers_status_idx
  on public.ticket_price_tiers (product_id, status);

-- =========================================================
-- Rebuild the three hold RPCs to track sold/reserved per tier as well as
-- per product. Items already carry tier_id (see lib/tickets/pricing.js).
-- =========================================================

create or replace function public.create_ticket_hold(
  p_event_id uuid,
  p_hold_token text,
  p_items jsonb,
  p_quantity_total integer,
  p_subtotal_cents bigint,
  p_currency text,
  p_user_id uuid,
  p_member_profile_id uuid,
  p_buyer_email text,
  p_expires_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_tier_id uuid;
  v_qty integer;
  v_updated uuid;
begin
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_tier_id := (v_item->>'tier_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;

    -- Reserve per-product capacity (unchanged; NULL capacity = unlimited).
    update public.ticket_inventory
      set reserved = reserved + v_qty,
          updated_at = now()
      where product_id = v_product_id
        and (capacity is null or (sold + reserved + v_qty) <= capacity)
      returning product_id into v_updated;

    if not found then
      raise exception 'INVENTORY_UNAVAILABLE:%', v_product_id;
    end if;

    -- Reserve per-tier capacity when tier_id is provided. NULL quantity =
    -- unlimited for that tier. Fail loudly if the tier is exhausted.
    if v_tier_id is not null then
      update public.ticket_price_tiers
        set reserved_count = reserved_count + v_qty,
            updated_at = now()
        where id = v_tier_id
          and (quantity is null or (sold_count + reserved_count + v_qty) <= quantity)
        returning id into v_updated;

      if not found then
        raise exception 'TIER_UNAVAILABLE:%', v_tier_id;
      end if;
    end if;
  end loop;

  insert into public.ticket_holds (
    event_id, hold_token, items, quantity_total, subtotal_cents,
    currency, user_id, member_profile_id, buyer_email, expires_at
  ) values (
    p_event_id, p_hold_token, p_items, p_quantity_total, p_subtotal_cents,
    coalesce(p_currency, 'usd'), p_user_id, p_member_profile_id,
    lower(p_buyer_email), p_expires_at
  ) returning id into v_hold_id;

  return v_hold_id;
end$$;

revoke all on function public.create_ticket_hold(uuid, text, jsonb, integer, bigint, text, uuid, uuid, text, timestamptz) from public, anon, authenticated;

create or replace function public.release_ticket_hold(p_hold_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold record;
  v_item jsonb;
  v_tier_id uuid;
begin
  select * into v_hold from public.ticket_holds where id = p_hold_id for update;
  if not found then return false; end if;
  if v_hold.status <> 'pending' then return false; end if;

  for v_item in select * from jsonb_array_elements(v_hold.items) loop
    update public.ticket_inventory
      set reserved = greatest(reserved - (v_item->>'quantity')::integer, 0),
          updated_at = now()
      where product_id = (v_item->>'product_id')::uuid;

    v_tier_id := (v_item->>'tier_id')::uuid;
    if v_tier_id is not null then
      update public.ticket_price_tiers
        set reserved_count = greatest(reserved_count - (v_item->>'quantity')::integer, 0),
            updated_at = now()
        where id = v_tier_id;
    end if;
  end loop;

  update public.ticket_holds
    set status = case when now() >= expires_at then 'expired' else 'released' end
    where id = p_hold_id;

  return true;
end$$;

revoke all on function public.release_ticket_hold(uuid) from public, anon, authenticated;

create or replace function public.consume_ticket_hold(p_hold_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold record;
  v_item jsonb;
  v_tier_id uuid;
begin
  select * into v_hold from public.ticket_holds where id = p_hold_id for update;
  if not found then return false; end if;
  if v_hold.status = 'consumed' then return true; end if;
  if v_hold.status <> 'pending' then
    raise exception 'HOLD_NOT_PENDING:%', v_hold.status;
  end if;

  for v_item in select * from jsonb_array_elements(v_hold.items) loop
    update public.ticket_inventory
      set sold = sold + (v_item->>'quantity')::integer,
          reserved = greatest(reserved - (v_item->>'quantity')::integer, 0),
          updated_at = now()
      where product_id = (v_item->>'product_id')::uuid;

    v_tier_id := (v_item->>'tier_id')::uuid;
    if v_tier_id is not null then
      update public.ticket_price_tiers
        set sold_count = sold_count + (v_item->>'quantity')::integer,
            reserved_count = greatest(reserved_count - (v_item->>'quantity')::integer, 0),
            updated_at = now()
        where id = v_tier_id;
    end if;
  end loop;

  update public.ticket_holds
    set status = 'consumed', consumed_at = now()
    where id = p_hold_id;

  return true;
end$$;

revoke all on function public.consume_ticket_hold(uuid) from public, anon, authenticated;