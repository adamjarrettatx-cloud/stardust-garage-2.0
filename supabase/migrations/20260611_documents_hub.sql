-- =========================================================
-- Secure Document Hub  (applied 2026-06-11)
-- Live on Supabase project iwgfelvbebqbaotkylsw (stardust-garage)
--
-- This file is the source-of-truth copy of the migration that was
-- applied via the Supabase MCP tool. Re-running it against a fresh
-- environment will recreate the schema exactly.
--
-- Security notes:
--   * is_admin() reads from public.team_members (server-controlled),
--     NOT from auth.users.raw_user_meta_data (Supabase advisor 0015).
--   * All RLS policies use is_admin(); service_role bypasses RLS.
--   * Audit log has insert+select policies only; updates/deletes are
--     denied for every non-service-role user (including admins).
--   * Storage bucket 'documents' is PRIVATE and gated by storage RLS.
-- =========================================================

create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.team_members
    where user_id = auth.uid() and role = 'admin'
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, anon;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text not null check (category in ('contracts','finance','sops','vendor','marketing','team','other')),
  counterparty text,
  status text not null default 'active' check (status in ('draft','active','archived')),
  event_id uuid references public.events(id) on delete set null,
  current_version_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_tsv tsvector
);
create index if not exists documents_category_idx   on public.documents(category);
create index if not exists documents_status_idx     on public.documents(status);
create index if not exists documents_event_id_idx   on public.documents(event_id);
create index if not exists documents_search_idx     on public.documents using gin(search_tsv);
create index if not exists documents_created_at_idx on public.documents(created_at desc);

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  version_number int not null,
  storage_path text not null unique,
  filename text not null,
  mime_type text,
  size_bytes bigint,
  checksum_sha256 text,
  notes text,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  unique (document_id, version_number)
);
create index if not exists document_versions_document_id_idx
  on public.document_versions(document_id, version_number desc);

alter table public.documents
  drop constraint if exists documents_current_version_fk;
alter table public.documents
  add constraint documents_current_version_fk
  foreign key (current_version_id) references public.document_versions(id) on delete set null
  deferrable initially deferred;

create table if not exists public.document_tags (
  document_id uuid not null references public.documents(id) on delete cascade,
  tag text not null check (length(tag) between 1 and 64),
  primary key (document_id, tag)
);
create index if not exists document_tags_tag_idx on public.document_tags(tag);

create table if not exists public.document_audit_log (
  id bigserial primary key,
  document_id uuid references public.documents(id) on delete set null,
  version_id uuid references public.document_versions(id) on delete set null,
  action text not null check (action in ('upload','view','download','update_metadata','delete','restore','new_version')),
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  ip_address text,
  user_agent text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists document_audit_log_document_id_idx on public.document_audit_log(document_id, created_at desc);
create index if not exists document_audit_log_actor_idx       on public.document_audit_log(actor_id, created_at desc);

-- Triggers
create or replace function public.documents_set_updated()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.search_tsv :=
    setweight(to_tsvector('simple', coalesce(new.title,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(new.counterparty,'')), 'B') ||
    setweight(to_tsvector('simple', coalesce(new.description,'')), 'C');
  return new;
end; $$;

drop trigger if exists documents_set_updated_trg on public.documents;
create trigger documents_set_updated_trg
before insert or update on public.documents
for each row execute function public.documents_set_updated();

create or replace function public.document_versions_set_number()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.version_number is null then
    select coalesce(max(version_number), 0) + 1
      into new.version_number
      from public.document_versions
     where document_id = new.document_id;
  end if;
  return new;
end; $$;

drop trigger if exists document_versions_set_number_trg on public.document_versions;
create trigger document_versions_set_number_trg
before insert on public.document_versions
for each row execute function public.document_versions_set_number();

create or replace function public.document_versions_set_current()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.documents
     set current_version_id = new.id,
         updated_at = now()
   where id = new.document_id;
  return new;
end; $$;

drop trigger if exists document_versions_set_current_trg on public.document_versions;
create trigger document_versions_set_current_trg
after insert on public.document_versions
for each row execute function public.document_versions_set_current();

-- RLS
alter table public.documents          enable row level security;
alter table public.document_versions  enable row level security;
alter table public.document_tags      enable row level security;
alter table public.document_audit_log enable row level security;

drop policy if exists documents_admin_select on public.documents;
drop policy if exists documents_admin_insert on public.documents;
drop policy if exists documents_admin_update on public.documents;
drop policy if exists documents_admin_delete on public.documents;
create policy documents_admin_select on public.documents for select to authenticated using (public.is_admin());
create policy documents_admin_insert on public.documents for insert to authenticated with check (public.is_admin());
create policy documents_admin_update on public.documents for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy documents_admin_delete on public.documents for delete to authenticated using (public.is_admin());

drop policy if exists versions_admin_select on public.document_versions;
drop policy if exists versions_admin_insert on public.document_versions;
drop policy if exists versions_admin_update on public.document_versions;
drop policy if exists versions_admin_delete on public.document_versions;
create policy versions_admin_select on public.document_versions for select to authenticated using (public.is_admin());
create policy versions_admin_insert on public.document_versions for insert to authenticated with check (public.is_admin());
create policy versions_admin_update on public.document_versions for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy versions_admin_delete on public.document_versions for delete to authenticated using (public.is_admin());

drop policy if exists tags_admin_select on public.document_tags;
drop policy if exists tags_admin_insert on public.document_tags;
drop policy if exists tags_admin_delete on public.document_tags;
create policy tags_admin_select on public.document_tags for select to authenticated using (public.is_admin());
create policy tags_admin_insert on public.document_tags for insert to authenticated with check (public.is_admin());
create policy tags_admin_delete on public.document_tags for delete to authenticated using (public.is_admin());

drop policy if exists audit_admin_select on public.document_audit_log;
drop policy if exists audit_admin_insert on public.document_audit_log;
create policy audit_admin_select on public.document_audit_log for select to authenticated using (public.is_admin());
create policy audit_admin_insert on public.document_audit_log for insert to authenticated with check (public.is_admin());
-- NO update/delete policies => denied for all non-service-role roles.

-- Storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents','documents', false, 104857600, null)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists documents_bucket_admin_select on storage.objects;
drop policy if exists documents_bucket_admin_insert on storage.objects;
drop policy if exists documents_bucket_admin_update on storage.objects;
drop policy if exists documents_bucket_admin_delete on storage.objects;
create policy documents_bucket_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.is_admin());
create policy documents_bucket_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.is_admin());
create policy documents_bucket_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'documents' and public.is_admin()) with check (bucket_id = 'documents' and public.is_admin());
create policy documents_bucket_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.is_admin());
