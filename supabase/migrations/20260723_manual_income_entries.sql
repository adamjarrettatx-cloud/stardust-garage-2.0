-- =========================================================
-- Manual Financial-Calendar Income  (additive — safe to apply)
--
-- This migration is PURELY ADDITIVE:
--   * creates one new function (public.is_owner())
--   * creates one new table (public.manual_income_entries)
--   * adds RLS policies that gate the table to the OWNER only
-- It does NOT alter or drop any existing column, table, policy, function, or
-- data. In particular it does NOT touch public.events,
-- public.event_ticket_metrics, or public.tt_discovered_events.
--
-- Purpose: the owner-only Financial Calendar tracks income by date. Some income
-- has NO local website event and NO TicketTailor record — e.g. a venue rental
-- paid directly. This table lets the owner record those amounts by hand so they
-- appear on the calendar and in monthly totals, without inventing a fake event
-- or writing to TicketTailor. A future SpotOn importer is a SEPARATE source and
-- does not use this table.
--
-- Money is stored in integer minor units (cents), matching the rest of the
-- financial-calendar pipeline (lib/event-analytics.js, event_ticket_metrics,
-- tt_discovered_events). Conversion to USD happens only at the render edge.
-- =========================================================

-- ---------------------------------------------------------------------------
-- Owner identity helper (server-controlled).
--
-- SECURITY: is_admin() only distinguishes admins, but manual income is
-- stricter — it must be readable/writable by the OWNER alone, not by every
-- admin/team member. There is no owner column on team_members, so we derive
-- ownership from the canonical owner email in auth.users. This mirrors
-- requireOwner()/ownerPageGate() in lib/auth-helpers.js (OWNER_EMAIL).
--
-- Why auth.users and not the JWT/user_metadata: auth.users.email is
-- server-controlled and cannot be edited by an end user, whereas
-- user_metadata is user-editable (Supabase advisor 0015) and must never be
-- used in a security context.
--
-- TRADE-OFF: the owner email is hard-coded here, duplicating the OWNER_EMAIL
-- constant in the app layer. That is intentional — Postgres RLS cannot read an
-- app env var, and a hard-coded server-side constant is far safer than trusting
-- any client-supplied claim. If the owner email ever changes it must be updated
-- in BOTH places (this function and lib/auth-helpers.js). The comparison is
-- lower-cased for robustness. security definer + a pinned search_path prevent
-- search-path hijacking, matching public.is_admin().
create or replace function public.is_owner()
returns boolean language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid()
      and lower(email) = 'adam@sdgatx.com'
  );
$$;
revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated, anon;

create table if not exists public.manual_income_entries (
  id uuid primary key default gen_random_uuid(),

  -- The calendar date this income is attributed to (YYYY-MM-DD).
  entry_date date not null,

  -- Human label for the line item (e.g. "SolarPunk venue rental").
  title text not null check (char_length(btrim(title)) between 1 and 200),

  -- Optional descriptive context. Neither is required.
  customer_name text check (customer_name is null or char_length(customer_name) <= 200),
  event_name    text check (event_name    is null or char_length(event_name)    <= 200),

  -- Category. Kept as free-ish text (NOT a Postgres enum) so new categories can
  -- be introduced from the app WITHOUT a schema migration — the canonical set
  -- lives in lib/manual-income.js (MANUAL_CATEGORIES) and is enforced there.
  -- The DB only guards length/non-emptiness. 'venue_rental' is the default and
  -- the motivating case; 'other' is the documented escape hatch.
  category text not null default 'venue_rental'
    check (char_length(btrim(category)) between 1 and 64),

  -- Income amount in integer cents. Non-negative; the app requires > 0.
  amount_cents bigint not null check (amount_cents >= 0),

  notes text check (notes is null or char_length(notes) <= 2000),

  -- Provenance. This table only ever holds hand-entered income. SpotOn (future)
  -- is a separate source and does NOT write here.
  source text not null default 'manual' check (source in ('manual')),

  -- Optional link to a local event, when the manual income happens to relate to
  -- one. Not required. ON DELETE SET NULL so deleting the event keeps the money.
  local_event_id uuid references public.events(id) on delete set null,

  -- Who created it (audit). Server sets this from the authenticated owner.
  created_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists manual_income_entries_date_idx        on public.manual_income_entries(entry_date);
create index if not exists manual_income_entries_category_idx     on public.manual_income_entries(category);
create index if not exists manual_income_entries_local_event_idx  on public.manual_income_entries(local_event_id);

-- Keep updated_at fresh on every write.
create or replace function public.manual_income_entries_set_updated()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists manual_income_entries_set_updated_trg on public.manual_income_entries;
create trigger manual_income_entries_set_updated_trg
before update on public.manual_income_entries
for each row execute function public.manual_income_entries_set_updated();

-- RLS: OWNER-ONLY reads AND writes. Stricter than is_admin(): a non-owner admin
-- or team member can neither see nor modify these rows. The service-role client
-- (owner-gated server component + owner-gated API route) bypasses RLS; these
-- policies are defense-in-depth so a direct authenticated client cannot reach
-- the data even if a query slipped through without the service-role key.
alter table public.manual_income_entries enable row level security;

drop policy if exists manual_income_entries_owner_select on public.manual_income_entries;
drop policy if exists manual_income_entries_owner_insert on public.manual_income_entries;
drop policy if exists manual_income_entries_owner_update on public.manual_income_entries;
drop policy if exists manual_income_entries_owner_delete on public.manual_income_entries;
create policy manual_income_entries_owner_select on public.manual_income_entries for select to authenticated using (public.is_owner());
create policy manual_income_entries_owner_insert on public.manual_income_entries for insert to authenticated with check (public.is_owner());
create policy manual_income_entries_owner_update on public.manual_income_entries for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy manual_income_entries_owner_delete on public.manual_income_entries for delete to authenticated using (public.is_owner());
