-- Track the tax portion of refunds separately from the total refund amount.
-- Without this, a refund like "$54.10 back" is opaque \u2014 we can't tell how
-- much of that was ticket + booking fee vs. Texas sales tax that must be
-- backed out of what SDG owes the state.
--
-- Split is proportional to the order's ORIGINAL tax ratio (tax_cents /
-- total_cents), computed at refund time. Historic orders with tax_cents = 0
-- naturally get refunded_tax_cents = 0, matching how they were sold.

alter table public.orders
  add column if not exists refunded_tax_cents bigint not null default 0
    check (refunded_tax_cents >= 0);

-- The refunded_tax_cents must never exceed the tax originally collected.
-- Belt-and-suspenders check; the API also clamps.
alter table public.orders
  drop constraint if exists orders_refunded_tax_le_collected;
alter table public.orders
  add constraint orders_refunded_tax_le_collected
  check (refunded_tax_cents <= tax_cents);
