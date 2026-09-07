-- Fix: purchasing a ticket returned "Not enough tickets available" whenever
-- the ticket_product had no ticket_inventory row.
--
-- Root cause: the admin product save only inserted a ticket_inventory row
-- when a numeric capacity was provided. Products created with unlimited
-- capacity (capacity = null, the default) were saved without an inventory
-- row at all. The `create_ticket_hold` RPC updates that row and treated
-- "0 rows updated" as INVENTORY_UNAVAILABLE, so an unlimited product was
-- effectively un-purchaseable.
--
-- Compounding this, the ticket_inventory table was originally created
-- with `capacity integer not null` plus a `sold + reserved <= capacity`
-- CHECK. The later 20260907_ticket_tier_quantity.sql migration updated
-- the hold RPC to treat `capacity is null` as unlimited, but never
-- relaxed those column-level constraints, so inserting a NULL-capacity
-- row was actually impossible.
--
-- Three changes in this migration:
--
--   1. Allow NULL capacity on ticket_inventory (unlimited) and drop the
--      composite CHECK that referenced it. Unlimited-capacity semantics
--      already live in the RPCs.
--   2. Backfill: insert a null-capacity ticket_inventory row for every
--      existing ticket_products row that doesn't already have one.
--   3. Rebuild create_ticket_hold so it self-heals: it inserts an
--      unlimited inventory row on demand if one is missing, before the
--      reservation update. Robust to any future caller or race that
--      creates a product without going through the admin route.
--
-- The admin route (app/api/admin/tickets/products/route.js) is also being
-- updated in this PR to always upsert the inventory row (unlimited when
-- no capacity is provided).

-- --- Relax ticket_inventory constraints ------------------------------------

alter table public.ticket_inventory
  alter column capacity drop not null;

alter table public.ticket_inventory
  drop constraint if exists ticket_inventory_check;

-- Also drop the anonymous per-row CHECK by name if it wasn't picked up above.
-- (Postgres auto-names table-level CHECKs `<table>_check`, `<table>_check1`,
-- etc. This DO block is defensive against install-time naming variation.)
do $$
declare
  con_name text;
begin
  for con_name in
    select conname
    from pg_constraint
    where conrelid = 'public.ticket_inventory'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%sold + reserved%capacity%'
  loop
    execute format('alter table public.ticket_inventory drop constraint %I', con_name);
  end loop;
end$$;

-- --- Backfill --------------------------------------------------------------

insert into public.ticket_inventory (product_id, capacity, sold, reserved)
select p.id, null, 0, 0
from public.ticket_products p
left join public.ticket_inventory i on i.product_id = p.id
where i.product_id is null;

-- --- Rebuild create_ticket_hold with self-heal ----------------------------

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

    -- Self-heal: ensure an inventory row exists for this product. Unlimited
    -- capacity is represented as NULL. Do nothing on conflict so a
    -- concurrent insert from another hold or the admin save doesn't blow
    -- up. product_id is the primary key on ticket_inventory.
    insert into public.ticket_inventory (product_id, capacity, sold, reserved)
    values (v_product_id, null, 0, 0)
    on conflict (product_id) do nothing;

    -- Reserve per-product capacity (NULL capacity = unlimited).
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

-- release_ticket_hold and consume_ticket_hold don't need the self-heal
-- (they only touch rows already created by create_ticket_hold), and are
-- left in place from 20260907_ticket_tier_quantity.sql.
