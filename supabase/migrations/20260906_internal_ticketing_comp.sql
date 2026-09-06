-- Follow-up migration for the internal ticketing PR. Adds the columns used
-- by /api/admin/tickets/comp and by the manual-resend/void audit paths.
-- Everything is additive and nullable so it is safe on prod.

-- Comp support on orders. `checkout_kind` mirrors what the Stripe metadata
-- flows populate (‘ticket_order’|‘save_payment_method’) plus ‘comp’ for
-- admin-issued no-charge orders. `comp_ref` gives operators an idempotency
-- key so double-clicks in the admin UI don’t double-issue tickets.
alter table public.orders
  add column if not exists checkout_kind text
    check (checkout_kind in ('ticket_order', 'save_payment_method', 'comp')),
  add column if not exists comp_ref text,
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;

-- One comp per (event_id, comp_ref). NULL comp_ref rows are ignored by the
-- partial index so real Stripe orders don’t collide.
create unique index if not exists orders_event_comp_ref_unique
  on public.orders(event_id, comp_ref)
  where comp_ref is not null;

create index if not exists orders_checkout_kind_idx on public.orders(checkout_kind);
