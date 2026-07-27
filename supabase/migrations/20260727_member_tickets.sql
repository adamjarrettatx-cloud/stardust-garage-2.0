-- Ticket wallet data model for the SDG mobile app.
--
-- Context: TicketTailor's order webhook payload already includes a full
-- `issued_tickets` array per order (barcode, qr_code_url, checked_in status,
-- ticket_type/description, per-ticket id "it_..."), which the existing
-- webhook (app/api/webhooks/tickettailor/route.js) already stores verbatim
-- inside ticket_order_attribution.raw_payload. Nothing needs to be fetched
-- from TicketTailor's API for a wallet -- we just need to flatten that JSON
-- into queryable rows the mobile app's RLS-scoped anon client can read
-- directly, instead of parsing raw_payload client-side (which would require
-- exposing the whole order/PII blob per ticket).
--
-- Matching a ticket to a member: TicketTailor orders carry a buyer email,
-- not a member id. We store buyer_email (lowercased) alongside a
-- best-effort member_id resolved at write time. RLS authorization, however,
-- is done by email match against the JWT, not by the member_id FK -- this
-- means a ticket bought before someone became a member (or before their
-- member_profiles row existed) still shows up correctly once they sign in
-- with the same email, with no backfill job required.
--
-- Scope: this is a read-facing wallet, not a replacement for TicketTailor's
-- own check-in tooling. `checked_in` here mirrors what TicketTailor reports
-- as of the last webhook delivery -- it is not written by the mobile app.
-- If/when SDG builds in-app door scanning, that's a separate feature that
-- would need to call TicketTailor's check-in API (source of truth) and this
-- table would just reflect the result via the next webhook delivery.

create table if not exists public.member_tickets (
  id text primary key, -- TicketTailor issued_ticket id, e.g. "it_131511517" -- stable, so this doubles as our idempotency key
  tt_order_id text not null references public.ticket_order_attribution(tt_order_id) on delete cascade,
  tt_event_id text,
  local_event_id uuid references public.events(id) on delete set null,
  member_id uuid references public.member_profiles(id) on delete set null, -- best-effort match at write time; not the security boundary (see RLS below)
  buyer_email text not null, -- lowercased
  ticket_type_id text,
  description text, -- e.g. "Tier 1 Tickets"
  status text not null default 'valid', -- 'valid' | 'void' -- from TT issued_ticket.status
  checked_in boolean not null default false, -- mirrors TT's checked_in flag as of last webhook delivery
  barcode text,
  barcode_url text,
  qr_code_url text,
  voided_at timestamptz,
  order_status text, -- denormalized copy of the parent order's status ('completed'/'canceled'/...) so a canceled order's tickets are easy to filter without a join
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists member_tickets_buyer_email_idx on public.member_tickets (lower(buyer_email));
create index if not exists member_tickets_member_id_idx on public.member_tickets (member_id);
create index if not exists member_tickets_tt_order_id_idx on public.member_tickets (tt_order_id);
create index if not exists member_tickets_local_event_id_idx on public.member_tickets (local_event_id);

create trigger member_tickets_set_updated_at
  before update on public.member_tickets
  for each row execute function public.handle_updated_at();

alter table public.member_tickets enable row level security;

-- Members see their own tickets by email match against their auth JWT --
-- this is the real security boundary, independent of the best-effort
-- member_id FK above, so a ticket bought before signup still resolves.
create policy "Members can view their own tickets" on public.member_tickets
  for select to authenticated
  using (lower(buyer_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Admins/team can see and manage all tickets (support, refund investigation,
-- future in-app check-in tooling).
create policy "Admins can manage all tickets" on public.member_tickets
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Team can view all tickets" on public.member_tickets
  for select to authenticated
  using (public.is_team_member());
