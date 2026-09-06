-- =========================================================
-- Internal Ticketing — additive schema for first-party ticket sales.
--
-- STRICTLY ADDITIVE. Does NOT alter or drop any existing table, column, or
-- policy. TicketTailor-linked events continue to work unchanged: this
-- migration only adds new tables plus one nullable column on public.events
-- ("ticketing_mode") that defaults to 'tickettailor', which is the current
-- behavior. Per-event opt-in to internal ticketing happens by flipping that
-- column to 'internal' — no bulk migration.
--
-- Money is stored in integer minor units (cents), matching Stripe and the
-- existing event_ticket_metrics table.
--
-- Security model:
--   * RLS enabled on every new table.
--   * There is NO public/anon write anywhere. All sensitive writes
--     (holds, orders, tickets, check-ins) go through server routes using
--     the service-role key, so RLS policies are read-only for members and
--     admins, and admin-only for anything sensitive.
--   * Card data (PAN/CVC) is NEVER stored. Only Stripe ids and card display
--     metadata (brand, last4, exp_month, exp_year) live in
--     saved_payment_method_refs.
--
-- Idempotency:
--   * Stripe webhooks may replay. orders.stripe_payment_intent_id is unique;
--     tickets are keyed by (order_item_id, seat_index) with a unique index;
--     stripe_event_ingest logs every processed event id so replays no-op.
-- =========================================================

-- One-off: add a per-event opt-in for internal ticketing without breaking
-- anything. Existing rows default to 'tickettailor', so nothing changes until
-- an admin explicitly flips a specific event to 'internal'.
alter table public.events
  add column if not exists ticketing_mode text
    not null default 'tickettailor'
    check (ticketing_mode in ('tickettailor', 'internal', 'external', 'none'));

create index if not exists events_ticketing_mode_idx
  on public.events(ticketing_mode);

-- =========================================================
-- ticket_products — one row per sellable ticket "kind" for an event
-- (e.g. "General", "Early Bird", "VIP"). Inventory + pricing live on
-- separate child tables so we can tier prices over time and track sold
-- counts atomically without rewriting product rows.
-- =========================================================
create table if not exists public.ticket_products (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  description text,
  -- Sales window (nullable = no bound). Enforced by server route on hold create.
  sales_start_at timestamptz,
  sales_end_at timestamptz,
  -- Per-order limits. NULL = unlimited (still bounded by inventory).
  min_per_order integer not null default 1 check (min_per_order >= 1),
  max_per_order integer,
  is_active boolean not null default true,
  member_only boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ticket_products_event_id_idx on public.ticket_products(event_id);
create index if not exists ticket_products_event_active_idx
  on public.ticket_products(event_id) where is_active = true;

-- =========================================================
-- ticket_price_tiers — priced windows for a product. The active tier for
-- "now" is the row whose (starts_at, ends_at) window contains now(), with
-- ties broken by display_order. This lets us schedule Early Bird -> GA
-- price transitions without touching the product.
-- =========================================================
create table if not exists public.ticket_price_tiers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.ticket_products(id) on delete cascade,
  name text not null,
  price_cents bigint not null check (price_cents >= 0),
  currency text not null default 'usd' check (char_length(currency) = 3),
  starts_at timestamptz,
  ends_at timestamptz,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists ticket_price_tiers_product_id_idx on public.ticket_price_tiers(product_id);
create index if not exists ticket_price_tiers_window_idx
  on public.ticket_price_tiers(product_id, starts_at, ends_at) where is_active = true;

-- =========================================================
-- ticket_inventory — one row per product with hard cap + reserved/sold
-- counters. The webhook increments sold; hold create/expire moves reserved.
-- Server code enforces (reserved + sold) <= capacity in an RPC.
-- =========================================================
create table if not exists public.ticket_inventory (
  product_id uuid primary key references public.ticket_products(id) on delete cascade,
  capacity integer not null check (capacity >= 0),
  sold integer not null default 0 check (sold >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  updated_at timestamptz not null default now(),
  check (sold + reserved <= capacity)
);

-- =========================================================
-- ticket_holds — short-lived reservations created before Stripe redirect.
-- Rows carry a signed opaque token the server passes to Stripe as metadata.
-- On webhook: verify hold, mark consumed, then issue tickets. Expired holds
-- are swept by a cron so counts free up automatically.
-- =========================================================
create table if not exists public.ticket_holds (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  hold_token text not null unique,
  -- Snapshot of what's being held. Persist as JSON so a schema change to
  -- product/tier doesn't invalidate an in-flight checkout.
  items jsonb not null,  -- [{product_id, tier_id, quantity, unit_price_cents}]
  quantity_total integer not null check (quantity_total > 0),
  subtotal_cents bigint not null check (subtotal_cents >= 0),
  currency text not null default 'usd',
  -- Optional buyer context — set once we know it, otherwise resolved from
  -- the Stripe Checkout Session on webhook.
  user_id uuid references auth.users(id) on delete set null,
  member_profile_id uuid references public.member_profiles(id) on delete set null,
  buyer_email text,
  status text not null default 'pending'
    check (status in ('pending', 'consumed', 'expired', 'released')),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ticket_holds_event_id_idx on public.ticket_holds(event_id);
create index if not exists ticket_holds_status_expires_idx on public.ticket_holds(status, expires_at);
create index if not exists ticket_holds_stripe_session_idx on public.ticket_holds(stripe_checkout_session_id);
create index if not exists ticket_holds_stripe_pi_idx on public.ticket_holds(stripe_payment_intent_id);

-- =========================================================
-- orders — one row per paid or attempted purchase. Source of truth for
-- what the buyer paid; ticket_holds is the pre-payment scratch pad, this
-- is what survives.
-- =========================================================
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  hold_id uuid references public.ticket_holds(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  member_profile_id uuid references public.member_profiles(id) on delete set null,
  buyer_email text not null,
  buyer_name text,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'refunded', 'partial_refund', 'void', 'failed')),
  subtotal_cents bigint not null check (subtotal_cents >= 0),
  fees_cents bigint not null default 0 check (fees_cents >= 0),
  total_cents bigint not null check (total_cents >= 0),
  refunded_cents bigint not null default 0 check (refunded_cents >= 0),
  currency text not null default 'usd',
  stripe_customer_id text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text unique,  -- unique => webhook idempotency
  stripe_charge_id text,
  paid_at timestamptz,
  refunded_at timestamptz,
  cancel_reason text,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_event_id_idx on public.orders(event_id);
create index if not exists orders_user_id_idx on public.orders(user_id);
create index if not exists orders_member_profile_id_idx on public.orders(member_profile_id);
create index if not exists orders_buyer_email_idx on public.orders(lower(buyer_email));
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_stripe_session_idx on public.orders(stripe_checkout_session_id);
create index if not exists orders_stripe_pi_idx on public.orders(stripe_payment_intent_id);

-- =========================================================
-- order_items — line items on an order (one per product line).
-- =========================================================
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.ticket_products(id) on delete restrict,
  tier_id uuid references public.ticket_price_tiers(id) on delete set null,
  product_name_snapshot text not null,  -- immutable label captured at purchase
  tier_name_snapshot text,
  quantity integer not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  subtotal_cents bigint not null check (subtotal_cents >= 0),
  created_at timestamptz not null default now()
);
create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists order_items_product_id_idx on public.order_items(product_id);

-- =========================================================
-- tickets — one row per admittable ticket. QR/code is derived from a
-- server-generated ticket_code that never leaves the database in plaintext
-- outside the ticket delivery pathway. Scanner validates by code.
-- =========================================================
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  event_id uuid not null references public.events(id) on delete restrict,
  product_id uuid not null references public.ticket_products(id) on delete restrict,
  seat_index integer not null check (seat_index >= 0),
  ticket_code text not null unique,  -- opaque, ~24 chars base32
  status text not null default 'valid'
    check (status in ('valid', 'used', 'refunded', 'void')),
  attendee_id uuid,  -- FK below via alter, avoids circular create order
  issued_at timestamptz not null default now(),
  used_at timestamptz,
  voided_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_item_id, seat_index)  -- idempotency of ticket issuance
);
create index if not exists tickets_event_id_status_idx on public.tickets(event_id, status);
create index if not exists tickets_order_id_idx on public.tickets(order_id);
create index if not exists tickets_ticket_code_idx on public.tickets(ticket_code);

-- =========================================================
-- attendees — optional per-ticket attendee info collected at checkout or
-- assigned later by the buyer. Split from tickets so ticket rows can be
-- issued the instant Stripe confirms payment, even if attendee details
-- come in a separate step.
-- =========================================================
create table if not exists public.attendees (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  ticket_id uuid unique references public.tickets(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists attendees_order_id_idx on public.attendees(order_id);
create index if not exists attendees_email_idx on public.attendees(lower(email));

alter table public.tickets
  add constraint tickets_attendee_id_fkey
  foreign key (attendee_id) references public.attendees(id) on delete set null;

-- =========================================================
-- saved_payment_method_refs — pointers to Stripe PaymentMethods for a
-- member. NEVER stores PAN or CVC — only Stripe ids and display metadata.
-- =========================================================
create table if not exists public.saved_payment_method_refs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  member_profile_id uuid references public.member_profiles(id) on delete set null,
  stripe_customer_id text not null,
  stripe_payment_method_id text not null unique,
  brand text,
  last4 text check (last4 is null or char_length(last4) = 4),
  exp_month integer check (exp_month is null or (exp_month between 1 and 12)),
  exp_year integer check (exp_year is null or exp_year between 2020 and 2100),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists saved_payment_method_refs_user_idx on public.saved_payment_method_refs(user_id);
create unique index if not exists saved_payment_method_refs_user_default_uidx
  on public.saved_payment_method_refs(user_id) where is_default;

-- =========================================================
-- ticket_checkins — one row per scan attempt. Scanner writes here so we
-- have a full audit trail (including duplicate-scan attempts).
-- =========================================================
create table if not exists public.ticket_checkins (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.tickets(id) on delete set null,
  event_id uuid not null references public.events(id) on delete cascade,
  ticket_code_attempted text not null,
  result text not null
    check (result in ('valid', 'already_used', 'refunded', 'void', 'wrong_event', 'not_found', 'override')),
  scanned_by uuid references auth.users(id) on delete set null,
  device_label text,
  note text,
  scanned_at timestamptz not null default now()
);
create index if not exists ticket_checkins_ticket_id_idx on public.ticket_checkins(ticket_id);
create index if not exists ticket_checkins_event_id_idx on public.ticket_checkins(event_id);
create index if not exists ticket_checkins_scanned_at_idx on public.ticket_checkins(scanned_at);

-- =========================================================
-- ticket_audit_log — everything sensitive: refund, comp, void, resend,
-- manual overrides, admin edits. Keep it long-lived.
-- =========================================================
create table if not exists public.ticket_audit_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  ticket_id uuid references public.tickets(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role text,  -- 'admin', 'system', 'webhook', 'scanner'
  action text not null,  -- 'order.paid', 'ticket.issued', 'ticket.refunded', ...
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ticket_audit_log_event_id_idx on public.ticket_audit_log(event_id);
create index if not exists ticket_audit_log_order_id_idx on public.ticket_audit_log(order_id);
create index if not exists ticket_audit_log_ticket_id_idx on public.ticket_audit_log(ticket_id);
create index if not exists ticket_audit_log_created_at_idx on public.ticket_audit_log(created_at);

-- =========================================================
-- stripe_event_ingest — persistent idempotency log for the shared Stripe
-- webhook endpoint. Recording the event id lets us return success on
-- replays without re-running fulfillment.
-- =========================================================
create table if not exists public.stripe_event_ingest (
  stripe_event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text,  -- 'ok', 'ignored', 'error'
  error_detail text
);
create index if not exists stripe_event_ingest_received_at_idx on public.stripe_event_ingest(received_at);

-- =========================================================
-- Triggers to keep updated_at fresh — reuse public.handle_updated_at()
-- from earlier migrations.
-- =========================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'ticket_products',
    'ticket_price_tiers',
    'ticket_inventory',
    'orders',
    'tickets',
    'attendees',
    'saved_payment_method_refs'
  ]
  loop
    execute format(
      'drop trigger if exists %I_set_updated_at on public.%I;
       create trigger %I_set_updated_at
       before update on public.%I
       for each row execute function public.handle_updated_at();',
      t, t, t, t
    );
  end loop;
end$$;

-- =========================================================
-- Atomic hold-creation RPC. Reserves inventory in a single transaction and
-- fails loudly if capacity would be exceeded. Server routes call this via
-- the service-role client. NEVER exposed to anon.
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
  v_qty integer;
begin
  -- Reserve inventory row-by-row with FOR UPDATE to avoid oversell races.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;

    update public.ticket_inventory
      set reserved = reserved + v_qty,
          updated_at = now()
      where product_id = v_product_id
        and (sold + reserved + v_qty) <= capacity
      returning product_id into v_product_id;

    if not found then
      raise exception 'INVENTORY_UNAVAILABLE:%', (v_item->>'product_id');
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

-- Release the inventory reserved by a hold. Idempotent — safe to call from
-- both the "user cancelled" path and the cron sweep.
create or replace function public.release_ticket_hold(p_hold_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold record;
  v_item jsonb;
begin
  select * into v_hold from public.ticket_holds where id = p_hold_id for update;
  if not found then return false; end if;
  if v_hold.status <> 'pending' then return false; end if;

  for v_item in select * from jsonb_array_elements(v_hold.items) loop
    update public.ticket_inventory
      set reserved = greatest(reserved - (v_item->>'quantity')::integer, 0),
          updated_at = now()
      where product_id = (v_item->>'product_id')::uuid;
  end loop;

  update public.ticket_holds
    set status = case when now() >= expires_at then 'expired' else 'released' end
    where id = p_hold_id;

  return true;
end$$;

revoke all on function public.release_ticket_hold(uuid) from public, anon, authenticated;

-- Convert a hold into sold inventory. Called from the webhook after Stripe
-- confirms payment. Atomic + idempotent (see check on status).
create or replace function public.consume_ticket_hold(p_hold_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold record;
  v_item jsonb;
begin
  select * into v_hold from public.ticket_holds where id = p_hold_id for update;
  if not found then return false; end if;
  if v_hold.status = 'consumed' then return true; end if;  -- idempotent
  if v_hold.status <> 'pending' then
    raise exception 'HOLD_NOT_PENDING:%', v_hold.status;
  end if;

  for v_item in select * from jsonb_array_elements(v_hold.items) loop
    update public.ticket_inventory
      set sold = sold + (v_item->>'quantity')::integer,
          reserved = greatest(reserved - (v_item->>'quantity')::integer, 0),
          updated_at = now()
      where product_id = (v_item->>'product_id')::uuid;
  end loop;

  update public.ticket_holds
    set status = 'consumed', consumed_at = now()
    where id = p_hold_id;

  return true;
end$$;

revoke all on function public.consume_ticket_hold(uuid) from public, anon, authenticated;

-- =========================================================
-- RLS.
-- =========================================================
alter table public.ticket_products enable row level security;
alter table public.ticket_price_tiers enable row level security;
alter table public.ticket_inventory enable row level security;
alter table public.ticket_holds enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.tickets enable row level security;
alter table public.attendees enable row level security;
alter table public.saved_payment_method_refs enable row level security;
alter table public.ticket_checkins enable row level security;
alter table public.ticket_audit_log enable row level security;
alter table public.stripe_event_ingest enable row level security;

-- Public reads for the product catalogue on published events. This is the
-- ONLY anon-visible surface. Inventory availability is exposed via a
-- narrower view (see below) that hides raw sold/reserved counts.
drop policy if exists ticket_products_public_read on public.ticket_products;
create policy ticket_products_public_read on public.ticket_products
  for select using (
    is_active = true
    and exists (
      select 1 from public.events e
      where e.id = ticket_products.event_id
        and e.status = 'published'
        and e.ticketing_mode = 'internal'
    )
  );

drop policy if exists ticket_price_tiers_public_read on public.ticket_price_tiers;
create policy ticket_price_tiers_public_read on public.ticket_price_tiers
  for select using (
    is_active = true
    and exists (
      select 1 from public.ticket_products p
      join public.events e on e.id = p.event_id
      where p.id = ticket_price_tiers.product_id
        and p.is_active = true
        and e.status = 'published'
        and e.ticketing_mode = 'internal'
    )
  );

-- Admin-only policies for management and read-back.
drop policy if exists ticket_products_admin_all on public.ticket_products;
create policy ticket_products_admin_all on public.ticket_products
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists ticket_price_tiers_admin_all on public.ticket_price_tiers;
create policy ticket_price_tiers_admin_all on public.ticket_price_tiers
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists ticket_inventory_admin_all on public.ticket_inventory;
create policy ticket_inventory_admin_all on public.ticket_inventory
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists ticket_holds_admin_read on public.ticket_holds;
create policy ticket_holds_admin_read on public.ticket_holds
  for select using (public.is_admin());

drop policy if exists orders_admin_all on public.orders;
create policy orders_admin_all on public.orders
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists order_items_admin_all on public.order_items;
create policy order_items_admin_all on public.order_items
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists tickets_admin_all on public.tickets;
create policy tickets_admin_all on public.tickets
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists attendees_admin_all on public.attendees;
create policy attendees_admin_all on public.attendees
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists saved_pm_refs_admin_all on public.saved_payment_method_refs;
create policy saved_pm_refs_admin_all on public.saved_payment_method_refs
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists ticket_checkins_admin_all on public.ticket_checkins;
create policy ticket_checkins_admin_all on public.ticket_checkins
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists ticket_audit_log_admin_read on public.ticket_audit_log;
create policy ticket_audit_log_admin_read on public.ticket_audit_log
  for select using (public.is_admin());

drop policy if exists stripe_event_ingest_admin_read on public.stripe_event_ingest;
create policy stripe_event_ingest_admin_read on public.stripe_event_ingest
  for select using (public.is_admin());

-- Member-facing reads. Buyer email match against JWT mirrors the
-- member_tickets pattern already used by the mobile wallet, so a purchase
-- made before the member row existed still shows up once they sign in.
drop policy if exists orders_member_read on public.orders;
create policy orders_member_read on public.orders
  for select using (
    (auth.uid() is not null and user_id = auth.uid())
    or (
      auth.jwt() ->> 'email' is not null
      and lower(auth.jwt() ->> 'email') = lower(buyer_email)
    )
  );

drop policy if exists order_items_member_read on public.order_items;
create policy order_items_member_read on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (
          (auth.uid() is not null and o.user_id = auth.uid())
          or (
            auth.jwt() ->> 'email' is not null
            and lower(auth.jwt() ->> 'email') = lower(o.buyer_email)
          )
        )
    )
  );

drop policy if exists tickets_member_read on public.tickets;
create policy tickets_member_read on public.tickets
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = tickets.order_id
        and (
          (auth.uid() is not null and o.user_id = auth.uid())
          or (
            auth.jwt() ->> 'email' is not null
            and lower(auth.jwt() ->> 'email') = lower(o.buyer_email)
          )
        )
    )
  );

drop policy if exists attendees_member_read on public.attendees;
create policy attendees_member_read on public.attendees
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = attendees.order_id
        and (
          (auth.uid() is not null and o.user_id = auth.uid())
          or (
            auth.jwt() ->> 'email' is not null
            and lower(auth.jwt() ->> 'email') = lower(o.buyer_email)
          )
        )
    )
  );

drop policy if exists saved_pm_refs_owner_read on public.saved_payment_method_refs;
create policy saved_pm_refs_owner_read on public.saved_payment_method_refs
  for select using (auth.uid() is not null and user_id = auth.uid());

-- =========================================================
-- Public availability view — safe to expose to anon. Exposes remaining
-- (capacity - sold - reserved) as a boolean + coarse bucket, never the
-- raw counts, so competitors/scripts can't monitor exact sales pace.
-- =========================================================
create or replace view public.ticket_product_availability
with (security_invoker = true)
as
select
  p.id as product_id,
  p.event_id,
  p.name,
  p.min_per_order,
  p.max_per_order,
  p.member_only,
  p.sales_start_at,
  p.sales_end_at,
  case
    when (i.capacity - i.sold - i.reserved) <= 0 then 'sold_out'
    when (i.capacity - i.sold - i.reserved) < 10 then 'limited'
    else 'available'
  end as availability
from public.ticket_products p
left join public.ticket_inventory i on i.product_id = p.id
where p.is_active = true;

comment on table public.ticket_products         is 'Sellable ticket kinds per internal-ticketing event.';
comment on table public.ticket_price_tiers      is 'Time-windowed prices for a ticket product (Early Bird / GA / etc).';
comment on table public.ticket_inventory        is 'Per-product capacity/sold/reserved counters; writes go through RPCs.';
comment on table public.ticket_holds            is 'Short-lived reservation created before Stripe redirect; expires if unpaid.';
comment on table public.orders                  is 'Paid or attempted internal ticket purchases; PI id unique for webhook idempotency.';
comment on table public.order_items             is 'Line items on an order (one row per ticket_products line).';
comment on table public.tickets                 is 'One admittable ticket. ticket_code drives QR + scanner validation.';
comment on table public.attendees               is 'Optional per-ticket attendee identity, filled at or after checkout.';
comment on table public.saved_payment_method_refs is 'Stripe PM pointers ONLY — never card PAN/CVC. Display metadata only.';
comment on table public.ticket_checkins         is 'Audit row per scan attempt, including duplicate/invalid tries.';
comment on table public.ticket_audit_log        is 'Long-lived audit log for sensitive ticket/order actions.';
comment on table public.stripe_event_ingest     is 'Idempotency log for Stripe webhook events (return success on replay).';
