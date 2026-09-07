-- Ticketing v2: booking fees, per-tier status/access-codes, tier reveal
-- threshold, and per-event discount codes.
-- Additive migration; nothing removed. Safe to apply while sales pipeline
-- is running because it only adds nullable columns / new tables.

-- 1. Event-level default booking fee (per ticket, in cents). $2.95 default.
alter table public.events
  add column if not exists booking_fee_cents_default integer not null default 295;

-- 2. Per-product "tier reveal threshold" — later tiers stay hidden on the
--    public site until the current tier has <= this many tickets remaining.
--    NULL means show all tiers always (old behavior).
alter table public.ticket_products
  add column if not exists tier_reveal_threshold integer;

-- 3. Per-tier: status, access codes, booking-fee override.
--    status:
--      'active'       (default) - visible + buyable
--      'hidden'       - never shown to the public
--      'sold_out'     - shown but disabled with "Sold Out" label
--      'access_code'  - hidden until a valid code from access_codes is entered
alter table public.ticket_price_tiers
  add column if not exists status text not null default 'active'
    check (status in ('active', 'hidden', 'sold_out', 'access_code')),
  add column if not exists access_codes text[],
  add column if not exists booking_fee_cents_override integer;

-- Backfill status from the existing is_active column so old rows behave
-- the same as before. is_active=false => hidden.
update public.ticket_price_tiers
   set status = case when is_active = false then 'hidden' else 'active' end
 where status = 'active' and is_active is not null;

-- 4. Discount codes table. Admin-created event-scoped promo codes. Distinct
--    from member_discount_codes, which is the TicketTailor per-member coupon
--    pipeline.
create table if not exists public.ticket_discount_codes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  code text not null,                     -- uppercased on write
  discount_type text not null check (discount_type in ('percent','amount')),
  discount_value integer not null check (discount_value >= 0),
  applies_to text not null default 'all_products'
    check (applies_to in ('all_products','specific')),
  product_ids uuid[],                     -- populated when applies_to='specific'
  max_redemptions integer,                -- null = unlimited
  redemptions_count integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  unique (event_id, code)
);

create index if not exists ticket_discount_codes_event_idx
  on public.ticket_discount_codes(event_id);
create index if not exists ticket_discount_codes_active_idx
  on public.ticket_discount_codes(event_id, is_active) where is_active = true;

-- 5. Snapshot discount + fees onto orders so historical orders don't change
--    if we later edit the code or fee. Additive columns.
alter table public.orders
  add column if not exists discount_code_id uuid references public.ticket_discount_codes(id),
  add column if not exists discount_code_snapshot text,
  add column if not exists discount_cents integer not null default 0,
  add column if not exists booking_fee_unit_cents integer;

-- 6. RLS for discount codes: admins full access; nobody else reads
--    (validation happens server-side through service role).
alter table public.ticket_discount_codes enable row level security;

drop policy if exists ticket_discount_codes_admin_all on public.ticket_discount_codes;
create policy ticket_discount_codes_admin_all
  on public.ticket_discount_codes
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 7. Atomic increment RPC for redemption counter. Prevents race with a bare
--    UPDATE ... SET redemptions_count = redemptions_count + 1 flow.
create or replace function public.increment_discount_code_redemption(
  p_code_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  updated int;
begin
  update public.ticket_discount_codes
     set redemptions_count = redemptions_count + 1,
         updated_at = now()
   where id = p_code_id
     and is_active = true
     and (max_redemptions is null or redemptions_count < max_redemptions);

  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'DISCOUNT_CODE_UNAVAILABLE';
  end if;
end;
$$;

revoke all on function public.increment_discount_code_redemption(uuid) from public;
grant execute on function public.increment_discount_code_redemption(uuid) to service_role;
