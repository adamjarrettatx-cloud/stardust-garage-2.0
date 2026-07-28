-- =========================================================
-- Potential Members — admin-curated pre-application list
--
-- WHY: Admins (and, later, scoped team members) meet people out in the world
-- they want as members before those people ever fill out the public
-- membership application. This gives admins a place to jot the person down
-- with contact info + notes as soon as they come to mind, instead of waiting
-- for a submission to land in Applications.
--
-- Deliberately separate from `membership_applications`: potential members are
-- admin-authored leads, not applicant-submitted data, and shouldn't be
-- confused with (or accidentally count toward) the real application queue.
--
-- Attribution: `added_by` points at `team_members.id` (not auth.users) so the
-- UI can show "Added by <full_name/email>" directly off the same table the
-- rest of the admin panel already joins against (see invited_by pattern on
-- team_members itself, and created_by on team_events/documents).
--
-- Access model (per 2026-07-27 decision): admin-role only for now, matching
-- the current /bananas gate. Nothing here grants team-role staff panel access;
-- extending this to team-role in the future is a separate, explicit change.
-- =========================================================

create table if not exists public.potential_members (
  id uuid primary key default gen_random_uuid(),

  full_name text not null,
  phone text,
  email text,
  notes text,

  -- potential   → just jotted down, no outreach yet
  -- contacted   → someone reached out to them
  -- invited     → sent them an application link / invited to apply
  -- converted   → they became a real member (optionally linked below)
  -- archived    → no longer relevant (didn't pan out, duplicate, etc.)
  status text not null default 'potential'
    check (status in ('potential', 'contacted', 'invited', 'converted', 'archived')),

  added_by uuid references public.team_members(id) on delete set null,
  converted_member_id uuid references public.member_profiles(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists potential_members_added_by_idx  on public.potential_members(added_by);
create index if not exists potential_members_status_idx    on public.potential_members(status);
create index if not exists potential_members_created_at_idx on public.potential_members(created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at bookkeeping trigger, matching the per-table pattern used
-- throughout the schema (documents_set_updated, member_tickets_set_updated_at,
-- etc.) rather than a shared generic trigger function.
-- ---------------------------------------------------------------------------
create or replace function public.potential_members_set_updated()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists potential_members_set_updated_trg on public.potential_members;
create trigger potential_members_set_updated_trg
before update on public.potential_members
for each row execute function public.potential_members_set_updated();

-- ---------------------------------------------------------------------------
-- RLS — admin-only, consistent with the 2026-07-27 hardening pass on
-- membership_applications / venue_inquiries / collaborations / etc., which
-- moved those tables from is_team() to is_admin(). public.is_admin() already
-- exists (20260611_documents_hub.sql) and reads team_members.role, not
-- user_metadata.
-- ---------------------------------------------------------------------------
alter table public.potential_members enable row level security;

drop policy if exists "Admins can view potential members" on public.potential_members;
create policy "Admins can view potential members" on public.potential_members
  for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins can insert potential members" on public.potential_members;
create policy "Admins can insert potential members" on public.potential_members
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Admins can update potential members" on public.potential_members;
create policy "Admins can update potential members" on public.potential_members
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can delete potential members" on public.potential_members;
create policy "Admins can delete potential members" on public.potential_members
  for delete to authenticated
  using (public.is_admin());
