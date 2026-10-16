-- Private spaces are open to everyone (owner's rule, 2026-10-09).
--
-- Every private-space rental is sold to the public at its sticker price;
-- active Insider members get 20% off at checkout (lib/membership-tiers.js).
-- Rather than reject a write that still says member_only = true (older admin
-- clients defaulted to it), coerce it, so no rental can become members-only.

update public.ticket_products
   set member_only = false,
       updated_at = now()
 where kind = 'private_space'
   and member_only = true;

create or replace function public.ticket_products_private_space_public()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind = 'private_space' then
    new.member_only := false;
  end if;
  return new;
end;
$$;

drop trigger if exists ticket_products_private_space_public on public.ticket_products;
create trigger ticket_products_private_space_public
  before insert or update of kind, member_only on public.ticket_products
  for each row execute function public.ticket_products_private_space_public();
