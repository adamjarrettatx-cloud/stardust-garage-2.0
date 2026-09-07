-- Texas sales tax (8.25%) on every ticket order, plus a new discount type:
-- 'target_total' — buyer sees an exact final dollar amount at checkout,
-- with the code back-solving so subtotal - discount + booking_fee + tax
-- equals that target.
--
-- Additive migration. Nothing existing is removed or backfilled destructively.
--   - Adds tax_cents columns to ticket_holds + orders (default 0 so old rows
--     read as untaxed, which matches how they were sold).
--   - Extends the discount_type check constraint on ticket_discount_codes to
--     include 'target_total'.
--
-- No Stripe passthrough here: Stripe's 2.9% + $0.30 continues to come out of
-- the SDG payout (buyer never sees a processing fee line). Tax base is
-- (subtotal - discount + booking_fee), per policy decided this session.

-- 1. Store tax on holds so the buyer-facing snapshot survives across the
--    pending → paid handoff and refunds/audits can split it back out.
alter table public.ticket_holds
  add column if not exists tax_cents bigint not null default 0
    check (tax_cents >= 0);

-- 2. Store tax on orders so historical reports can separate the collected
--    sales tax from ticket revenue / booking fees.
alter table public.orders
  add column if not exists tax_cents bigint not null default 0
    check (tax_cents >= 0);

-- 3. Allow the new discount_type. We recreate the check constraint because
--    Postgres check constraints aren't ALTER-able in place.
alter table public.ticket_discount_codes
  drop constraint if exists ticket_discount_codes_discount_type_check;
alter table public.ticket_discount_codes
  add constraint ticket_discount_codes_discount_type_check
  check (discount_type in ('percent', 'amount', 'target_total'));

-- Cheap sanity comment for future readers: discount_value stores CENTS for
-- 'amount' and 'target_total', and 0-100 (integer) for 'percent'. The API
-- + admin UI validate this shape before insert; nothing else in the schema
-- distinguishes the three types.
