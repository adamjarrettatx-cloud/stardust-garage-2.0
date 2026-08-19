-- =========================================================
-- Artist / DJ Pay System — Phase 1 (part A): contractor tax tracking
--
-- WHY: artists/DJs paid through the upcoming pay-request + Mercury flow are
-- 1099 contractors, not employees. Before any money moves we need a place to
-- know (a) whether a W9 is on file for a contact and (b) what entity they're
-- paid as, so a later "who needs a 1099-NEC this year" view has something to
-- read. Actual cumulative-pay totals are computed on demand from
-- artist_pay_requests once that table exists (Phase 3) — this migration only
-- ships the W9-tracking half.
--
-- SECURITY: this table is staff-only, full stop — no partner policy exists
-- here at all, unlike partner_profiles/event_guestlist_grants which do grant
-- partners a narrow self-view. An artist's own tax status/entity type is not
-- something their own portal login should ever be able to read. Nothing here
-- stores an SSN or EIN — w9_document_id points at the existing private
-- Documents Hub (documents/document_versions, storage bucket "documents"),
-- which already has its own access-logged download path
-- (lib/document-helpers.js streamDocumentVersion). This table just tracks
-- "is a W9 on file, and if so which document is it."
-- =========================================================

-- ---------------------------------------------------------------------------
-- Documents Hub gets a new category so a W9 upload doesn't have to be
-- mislabeled as "finance" or "other". Widening a check constraint, not adding
-- one, so this is safe to run even though documents.category already has
-- rows under the old constraint.
-- ---------------------------------------------------------------------------
alter table public.documents drop constraint if exists documents_category_check;
alter table public.documents add constraint documents_category_check
  check (category in ('contracts','finance','sops','vendor','marketing','team','tax','other'));

create table if not exists public.contact_tax_profiles (
  id uuid primary key default gen_random_uuid(),
  -- One tax profile per contact/org, mirroring partner_profiles' one-row-per-contact shape.
  contact_id uuid not null unique references public.contacts(id) on delete cascade,
  entity_type text not null default 'individual'
    check (entity_type in ('individual', 'llc', 'other')),
  w9_on_file boolean not null default false,
  -- Set null (not cascaded away) if the underlying document is ever deleted —
  -- we still want the row to say "we used to have one, it's gone now" rather
  -- than silently vanishing.
  w9_document_id uuid references public.documents(id) on delete set null,
  w9_received_at timestamptz,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contact_tax_profiles_contact_id_idx on public.contact_tax_profiles(contact_id);
create index if not exists contact_tax_profiles_w9_on_file_idx on public.contact_tax_profiles(w9_on_file);

create or replace function public.contact_tax_profiles_set_updated()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists contact_tax_profiles_set_updated_trg on public.contact_tax_profiles;
create trigger contact_tax_profiles_set_updated_trg
before update on public.contact_tax_profiles
for each row execute function public.contact_tax_profiles_set_updated();

-- ---------------------------------------------------------------------------
-- RLS — team can read (they need to see W9 status while booking an artist),
-- only admins can write (matches who is allowed to invite/manage a contact's
-- money-adjacent records elsewhere in this codebase, e.g. partner_profiles).
-- ---------------------------------------------------------------------------
alter table public.contact_tax_profiles enable row level security;

drop policy if exists "Team can view tax profiles" on public.contact_tax_profiles;
create policy "Team can view tax profiles" on public.contact_tax_profiles
  for select to authenticated
  using (public.is_team());

drop policy if exists "Admins can manage tax profiles" on public.contact_tax_profiles;
create policy "Admins can manage tax profiles" on public.contact_tax_profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
