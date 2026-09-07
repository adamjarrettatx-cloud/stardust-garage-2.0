-- Add a 'kind' discriminator to ticket_products so we can render
-- fundamentally different offerings (regular ticket ladders vs. private-space
-- rentals) with different admin UIs while still storing them in one table.
--
--   'tickets'       - the default "Tickets" product with a tier ladder
--                     (Early Bird -> Phase 1 -> ... -> GA). One per event.
--   'private_space' - a rentable space attached to the event (e.g. Outer
--                     Space green room). Single price, no tier ladder,
--                     usually low capacity (1-2).
--
-- Old rows keep working: they default to 'tickets'.

alter table public.ticket_products
  add column if not exists kind text not null default 'tickets';

alter table public.ticket_products
  drop constraint if exists ticket_products_kind_check;

alter table public.ticket_products
  add constraint ticket_products_kind_check
  check (kind in ('tickets', 'private_space'));

comment on column public.ticket_products.kind is
  'tickets = default ticket product with tier ladder. private_space = rentable space (single-price, no tiers).';

create index if not exists ticket_products_event_kind_idx
  on public.ticket_products (event_id, kind);
