-- Owner-only permanent deletion of banned/restricted entries (for mistakes).
-- Only the single permission owner (Adam Jarrett, adam@sdgatx.com) may delete.
-- The entry, its notes, overrides and photos are removed. A minimal private
-- deletion log (who, when, name, why) is kept for the owner only.
begin;

create table if not exists public.access_restriction_deletions (
  id uuid primary key default gen_random_uuid(),
  restriction_id uuid not null,
  full_name text not null,
  kind text not null,
  deletion_reason text not null check (length(btrim(deletion_reason)) between 1 and 2000),
  deleted_by uuid not null references auth.users(id),
  deleted_at timestamptz not null default now()
);
alter table public.access_restriction_deletions enable row level security;
revoke all on public.access_restriction_deletions from public, anon, authenticated;
grant select, insert on public.access_restriction_deletions to service_role;

-- Security-incident history survives; a ban/review incident may point at a
-- deleted entry instead of a live one.
alter table public.security_incidents add column if not exists restriction_deleted_at timestamptz;
alter table public.security_incidents drop constraint if exists security_incidents_check;
alter table public.security_incidents add constraint security_incidents_check
  check ((action in ('ban','review')) = (restriction_id is not null or restriction_deleted_at is not null));

-- Incident history stays append-only. The single permitted change is the
-- owner's delete unlinking the deleted entry: only restriction_id -> null and
-- restriction_deleted_at set, inside delete_access_restriction's transaction.
create or replace function public.guard_security_incident_change() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE'
    and current_setting('sdg.restriction_delete', true) = old.restriction_id::text
    and new.restriction_id is null and old.restriction_deleted_at is null and new.restriction_deleted_at is not null
    and (to_jsonb(new) - 'restriction_id' - 'restriction_deleted_at') = (to_jsonb(old) - 'restriction_id' - 'restriction_deleted_at') then
    return new;
  end if;
  raise exception 'Security history is append-only';
end $$;
revoke all on function public.guard_security_incident_change() from public, anon, authenticated;
drop trigger if exists security_incidents_immutable on public.security_incidents;
create trigger security_incidents_immutable before update or delete on public.security_incidents
  for each row execute function public.guard_security_incident_change();

create or replace function public.delete_access_restriction(p_actor uuid, p_id uuid, p_reason text)
returns text[] language plpgsql security invoker set search_path = public as $$
declare v_row public.access_restrictions; v_reason text := btrim(coalesce(p_reason, '')); v_photos text[];
begin
  if not exists (
    select 1 from public.access_restriction_managers m
    join public.team_members t on t.user_id = m.user_id
    where m.user_id = p_actor and m.can_manage_permissions and t.role = 'admin'
      and lower(t.email) = 'adam@sdgatx.com'
  ) then
    raise exception 'Only the owner can delete banned-list entries' using errcode = '42501';
  end if;
  if length(v_reason) not between 1 and 2000 then raise exception 'A reason for deleting is required.'; end if;
  select * into v_row from public.access_restrictions where id = p_id for update;
  if not found then raise exception 'Restriction not found'; end if;
  insert into public.access_restriction_deletions(restriction_id, full_name, kind, deletion_reason, deleted_by)
    values (v_row.id, v_row.full_name, v_row.kind, v_reason, p_actor);
  perform set_config('sdg.restriction_delete', p_id::text, true);
  update public.security_incidents set restriction_id = null, restriction_deleted_at = now() where restriction_id = p_id;
  delete from public.access_restriction_exclusions where restriction_id = p_id;
  delete from public.access_restriction_events where restriction_id = p_id;
  delete from public.access_restrictions where id = p_id;
  perform set_config('sdg.restriction_delete', '', true);
  -- Caller removes every stored photo under this entry's folder.
  v_photos := case when v_row.photo_path is null then '{}' else array[v_row.photo_path] end;
  return v_photos;
end $$;
revoke all on function public.delete_access_restriction(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.delete_access_restriction(uuid,uuid,text) to service_role;
commit;
