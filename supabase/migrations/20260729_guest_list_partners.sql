-- =========================================================
-- Guest List — Phase 1 data model (partners, grants, entries, guests)
--
-- WHY: promoters, collectives and vendors currently text us the names they want
-- on the door for their night, and someone on staff keeps that list in their
-- phone. This moves it into the product: a Contact can be given a lightweight
-- "Partner" login that can do exactly one thing — add named guests against a
-- per-event allocation an admin grants them — and door staff check those guests
-- in from a kiosk view later (Phase 3/4).
--
-- Four distinct kinds of people are involved here, and the schema keeps them
-- apart on purpose:
--   * team_members   — staff. Grant slots, check guests in.
--   * contacts       — the org/person we do business with (existing table).
--   * partner_profiles — a contact's login. NOT a team member, NOT a member.
--                      Non-admin, non-team, non-member: public pages, their own
--                      profile, and their guest list. Nothing else.
--   * guest_profiles — the human who actually walks in the door. No auth
--                      account, ever. Staff-only data (phone/email) so a
--                      returning guest never re-does door signup.
--
-- SECURITY / RLS: matches the bar set by 20260727_rls_security_hardening.sql —
-- every table below has RLS enabled with explicit policies, and no policy
-- trusts user_metadata. Two things are worth calling out:
--   1. guest_profiles is admin/team ONLY. Partners must never see the phone or
--      email of an attendee, including the guests they personally added.
--   2. partner_profiles.is_active is the switch that turns a login into a real
--      partner, so partners are granted UPDATE on (full_name, photo_url) only —
--      a column-level GRANT, because RLS policies cannot restrict columns and
--      WITH CHECK cannot see the old row. Activation itself is written with the
--      service-role key from /api/partner/complete-activation.
--
-- Phase 1 + 2 ship the tables, the invite and the activation flow. The
-- allocation UI, the partner guest-list page and the door kiosk are follow-ups;
-- the policies below are already written for them so those tickets are UI-only.
-- =========================================================

-- ---------------------------------------------------------------------------
-- Partner identity helpers. Definer functions in the same shape as the
-- existing public.is_admin() / public.is_team() / public.is_owner(), so the
-- policies below read as one-liners and never recurse into the RLS of the
-- table they are protecting.
--
-- partner_contact_id() deliberately requires is_active — an invited-but-not-yet
-- activated partner resolves to NULL and therefore sees nothing at all.
-- ---------------------------------------------------------------------------
create or replace function public.partner_contact_id()
returns uuid language sql stable security definer
set search_path = public, auth
as $$
  select p.contact_id
  from public.partner_profiles p
  where p.user_id = auth.uid() and p.is_active
  limit 1;
$$;
revoke all on function public.partner_contact_id() from public;
grant execute on function public.partner_contact_id() to authenticated;

-- ---------------------------------------------------------------------------
-- 1. partner_profiles — one login per contact, mirroring member_profiles.
--
-- invited_by points at auth.users rather than team_members because the invite
-- route already holds the admin's auth user (same as team_members.invited_by,
-- which is also an auth.users id despite the sibling column names elsewhere).
-- ---------------------------------------------------------------------------
create table if not exists public.partner_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  -- One partner account per contact. Re-inviting the same contact updates this
  -- row instead of creating a second login for the same organization.
  contact_id uuid not null unique references public.contacts(id) on delete cascade,
  full_name text,
  -- Required before is_active flips, exactly like member_profiles.photo_url:
  -- door staff need a face to match against.
  photo_url text,
  is_active boolean not null default false,
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  activated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists partner_profiles_contact_id_idx on public.partner_profiles(contact_id);
create index if not exists partner_profiles_is_active_idx  on public.partner_profiles(is_active);

-- ---------------------------------------------------------------------------
-- 2. guest_profiles — the reusable identity of an actual attendee.
--
-- The whole point: once a human has completed door check-in anywhere, ever,
-- they never re-do the phone/email signup. Check-in staff match on name from
-- then on, which is why the case-insensitive name index exists.
-- ---------------------------------------------------------------------------
create table if not exists public.guest_profiles (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  marketing_consent boolean not null default false,
  first_seen_event_id uuid references public.events(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Name matching at the door is typed by a human on a laptop; index the folded
-- form so `where lower(full_name) = lower($1)` stays an index scan.
create index if not exists guest_profiles_full_name_lower_idx on public.guest_profiles(lower(full_name));
create index if not exists guest_profiles_created_at_idx      on public.guest_profiles(created_at desc);

-- ---------------------------------------------------------------------------
-- 3. event_guestlist_grants — the allocation an admin gives a contact for one
--    event. free_slots + discount_slots is what the partner may actually spend;
--    total_slots is the ceiling the admin agreed to.
-- ---------------------------------------------------------------------------
create table if not exists public.event_guestlist_grants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  total_slots int not null default 0 check (total_slots >= 0),
  free_slots int not null default 0 check (free_slots >= 0),
  discount_slots int not null default 0 check (discount_slots >= 0),
  -- Free-form on purpose: "50% off door", "$10 flat", "2-for-1 before 11".
  -- Door staff read it; we are not modelling a discount engine.
  discount_detail text,
  granted_by uuid references public.team_members(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_guestlist_grants_slots_check
    check (free_slots + discount_slots <= total_slots),
  -- One allocation row per contact per event; changing an allocation is an
  -- update, so the audit log shows the history.
  constraint event_guestlist_grants_event_contact_key unique (event_id, contact_id)
);

create index if not exists event_guestlist_grants_event_id_idx   on public.event_guestlist_grants(event_id);
create index if not exists event_guestlist_grants_contact_id_idx on public.event_guestlist_grants(contact_id);

-- ---------------------------------------------------------------------------
-- 4. event_guestlist_entries — the named guests a partner adds against a grant.
--
-- guest_profile_id is null until the door links this name to a real
-- guest_profiles row at check-in.
-- ---------------------------------------------------------------------------
create table if not exists public.event_guestlist_entries (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.event_guestlist_grants(id) on delete cascade,
  guest_name text not null,
  comp_type text not null check (comp_type in ('free', 'discount')),
  guest_profile_id uuid references public.guest_profiles(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'checked_in', 'no_show')),
  checked_in_at timestamptz,
  checked_in_by uuid references public.team_members(id) on delete set null,
  -- The partner who typed the name in (auth.users, not team_members).
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists event_guestlist_entries_grant_id_idx     on public.event_guestlist_entries(grant_id);
create index if not exists event_guestlist_entries_status_idx       on public.event_guestlist_entries(status);
create index if not exists event_guestlist_entries_guest_lower_idx  on public.event_guestlist_entries(lower(guest_name));
create index if not exists event_guestlist_entries_guest_profile_idx on public.event_guestlist_entries(guest_profile_id);

-- ---------------------------------------------------------------------------
-- 5. guestlist_audit_log — append-only history, mirroring contact_audit_log.
--
-- Both foreign keys are ON DELETE SET NULL, not CASCADE: the reason to keep an
-- audit trail at all is to still have "who removed this guest" after the entry
-- (or the whole grant) is gone.
-- ---------------------------------------------------------------------------
create table if not exists public.guestlist_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in (
    'grant_created', 'grant_updated', 'grant_revoked',
    'entry_added', 'entry_removed', 'checked_in'
  )),
  grant_id uuid references public.event_guestlist_grants(id) on delete set null,
  entry_id uuid references public.event_guestlist_entries(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  ip_address text,
  user_agent text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists guestlist_audit_log_grant_id_idx   on public.guestlist_audit_log(grant_id);
create index if not exists guestlist_audit_log_entry_id_idx   on public.guestlist_audit_log(entry_id);
create index if not exists guestlist_audit_log_created_at_idx on public.guestlist_audit_log(created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at bookkeeping, following the per-table trigger pattern used by
-- potential_members_set_updated / member_tickets_set_updated_at rather than a
-- shared generic function.
-- ---------------------------------------------------------------------------
create or replace function public.event_guestlist_grants_set_updated()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists event_guestlist_grants_set_updated_trg on public.event_guestlist_grants;
create trigger event_guestlist_grants_set_updated_trg
before update on public.event_guestlist_grants
for each row execute function public.event_guestlist_grants_set_updated();

create or replace function public.event_guestlist_entries_set_updated()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists event_guestlist_entries_set_updated_trg on public.event_guestlist_entries;
create trigger event_guestlist_entries_set_updated_trg
before update on public.event_guestlist_entries
for each row execute function public.event_guestlist_entries_set_updated();

-- ---------------------------------------------------------------------------
-- Grant ownership predicate. Used by the entries policies: a subquery written
-- inline there would itself be filtered by the grants policies, so the check
-- lives in a definer function instead.
-- ---------------------------------------------------------------------------
create or replace function public.partner_owns_grant(p_grant_id uuid)
returns boolean language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.event_guestlist_grants g
    where g.id = p_grant_id
      and g.contact_id = public.partner_contact_id()
  );
$$;
revoke all on function public.partner_owns_grant(uuid) from public;
grant execute on function public.partner_owns_grant(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Safe self-view for the partner area. contacts carries internal_notes and
-- other staff-only fields, so partners are NOT given a select policy on it —
-- this function hands back only the columns the partner may see about their own
-- organization.
-- ---------------------------------------------------------------------------
create or replace function public.partner_self()
returns table (
  id uuid,
  contact_id uuid,
  full_name text,
  photo_url text,
  is_active boolean,
  invited_at timestamptz,
  activated_at timestamptz,
  contact_display_name text,
  -- jsonb rather than text[] so this signature does not have to restate the
  -- storage type of contacts.contact_type; either way it arrives in JS as an
  -- array of the CONTACT_TYPE_OPTIONS values.
  contact_type jsonb
)
language sql stable security definer
set search_path = public, auth
as $$
  select p.id, p.contact_id, p.full_name, p.photo_url, p.is_active,
         p.invited_at, p.activated_at, c.display_name, to_jsonb(c.contact_type)
  from public.partner_profiles p
  join public.contacts c on c.id = p.contact_id
  where p.user_id = auth.uid();
$$;
revoke all on function public.partner_self() from public;
grant execute on function public.partner_self() to authenticated;

-- =========================================================
-- RLS
-- =========================================================

-- ---------------------------------------------------------------------------
-- partner_profiles: a partner reads and edits their own row; admins see all.
-- Team-role staff are intentionally not given access — inviting partners is an
-- admin action, same posture as membership_applications after the 2026-07-27
-- hardening pass.
-- ---------------------------------------------------------------------------
alter table public.partner_profiles enable row level security;

drop policy if exists "Partners can view their own profile" on public.partner_profiles;
create policy "Partners can view their own profile" on public.partner_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Partners can update their own profile" on public.partner_profiles;
create policy "Partners can update their own profile" on public.partner_profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Admins can manage partner profiles" on public.partner_profiles;
create policy "Admins can manage partner profiles" on public.partner_profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Column-level grant, because the UPDATE policy above cannot stop a partner
-- from rewriting is_active or contact_id (RLS has no column scope, and WITH
-- CHECK cannot compare against the old row). Everything privileged —
-- is_active, activated_at, contact_id, invited_by — is written with the
-- service-role key by the invite / complete-activation routes.
--
-- This applies to admins on the anon key too: an admin cannot flip is_active
-- with a direct Supabase call, only through /api/admin/invite-partner and
-- /api/partner/complete-activation. That is the intent — activation requires a
-- photo, and the gate for that rule lives in the route.
revoke update on public.partner_profiles from authenticated;
grant update (full_name, photo_url) on public.partner_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- guest_profiles: staff only, full stop. This table holds attendee phone
-- numbers and email addresses; partners and the public never touch it.
-- ---------------------------------------------------------------------------
alter table public.guest_profiles enable row level security;

drop policy if exists "Team can view guest profiles" on public.guest_profiles;
create policy "Team can view guest profiles" on public.guest_profiles
  for select to authenticated
  using (public.is_team());

drop policy if exists "Team can insert guest profiles" on public.guest_profiles;
create policy "Team can insert guest profiles" on public.guest_profiles
  for insert to authenticated
  with check (public.is_team());

drop policy if exists "Team can update guest profiles" on public.guest_profiles;
create policy "Team can update guest profiles" on public.guest_profiles
  for update to authenticated
  using (public.is_team())
  with check (public.is_team());

drop policy if exists "Admins can delete guest profiles" on public.guest_profiles;
create policy "Admins can delete guest profiles" on public.guest_profiles
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- event_guestlist_grants: partners read their own allocation and nothing else
-- (no writes — how many slots you get is not yours to decide). Admin/team
-- manage allocations.
-- ---------------------------------------------------------------------------
alter table public.event_guestlist_grants enable row level security;

drop policy if exists "Partners can view their own grants" on public.event_guestlist_grants;
create policy "Partners can view their own grants" on public.event_guestlist_grants
  for select to authenticated
  using (contact_id = public.partner_contact_id());

drop policy if exists "Team can view all grants" on public.event_guestlist_grants;
create policy "Team can view all grants" on public.event_guestlist_grants
  for select to authenticated
  using (public.is_team());

drop policy if exists "Team can insert grants" on public.event_guestlist_grants;
create policy "Team can insert grants" on public.event_guestlist_grants
  for insert to authenticated
  with check (public.is_team());

drop policy if exists "Team can update grants" on public.event_guestlist_grants;
create policy "Team can update grants" on public.event_guestlist_grants
  for update to authenticated
  using (public.is_team())
  with check (public.is_team());

drop policy if exists "Admins can delete grants" on public.event_guestlist_grants;
create policy "Admins can delete grants" on public.event_guestlist_grants
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- event_guestlist_entries: a partner owns the names under their own grants.
-- Admin/team get full access because the door kiosk checks guests in.
--
-- Note the partner INSERT/UPDATE checks do not verify the entry still fits
-- inside the allocation — slot accounting is enforced by the Phase 3 route that
-- writes these rows, since a policy cannot count sibling rows without
-- serializing concurrent inserts.
-- ---------------------------------------------------------------------------
alter table public.event_guestlist_entries enable row level security;

drop policy if exists "Partners can view their own entries" on public.event_guestlist_entries;
create policy "Partners can view their own entries" on public.event_guestlist_entries
  for select to authenticated
  using (public.partner_owns_grant(grant_id));

drop policy if exists "Partners can add their own entries" on public.event_guestlist_entries;
create policy "Partners can add their own entries" on public.event_guestlist_entries
  for insert to authenticated
  with check (public.partner_owns_grant(grant_id));

drop policy if exists "Partners can update their own entries" on public.event_guestlist_entries;
create policy "Partners can update their own entries" on public.event_guestlist_entries
  for update to authenticated
  using (public.partner_owns_grant(grant_id))
  with check (public.partner_owns_grant(grant_id));

drop policy if exists "Partners can remove their own entries" on public.event_guestlist_entries;
create policy "Partners can remove their own entries" on public.event_guestlist_entries
  for delete to authenticated
  using (public.partner_owns_grant(grant_id));

drop policy if exists "Team can manage all entries" on public.event_guestlist_entries;
create policy "Team can manage all entries" on public.event_guestlist_entries
  for all to authenticated
  using (public.is_team())
  with check (public.is_team());

-- ---------------------------------------------------------------------------
-- guestlist_audit_log: insert + select only, no update/delete policy for
-- anyone. History is immutable except to service_role, matching capacity_events
-- and document_audit_log.
-- ---------------------------------------------------------------------------
alter table public.guestlist_audit_log enable row level security;

drop policy if exists "Team can view guestlist audit log" on public.guestlist_audit_log;
create policy "Team can view guestlist audit log" on public.guestlist_audit_log
  for select to authenticated
  using (public.is_team());

drop policy if exists "Team can insert guestlist audit rows" on public.guestlist_audit_log;
create policy "Team can insert guestlist audit rows" on public.guestlist_audit_log
  for insert to authenticated
  with check (public.is_team());
