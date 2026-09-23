-- Private door safety records. No direct browser/mobile reads or writes.
begin;
create table public.access_restrictions (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(full_name) between 1 and 160),
  kind text not null check (kind in ('banned','temporary','review')),
  reason text not null check (length(reason) between 1 and 2000),
  identifying_details text not null default '',
  match_keys text[] not null default '{}',
  identity_keys text[] not null default '{}',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  lifted_at timestamptz,
  lifted_by uuid references auth.users(id),
  lift_reason text,
  check ((kind = 'temporary' and expires_at is not null) or (kind <> 'temporary' and expires_at is null))
);
create index access_restrictions_match on public.access_restrictions using gin(match_keys);
create index access_restrictions_identity on public.access_restrictions using gin(identity_keys);
create table public.access_restriction_events (
  id uuid primary key default gen_random_uuid(),
  restriction_id uuid not null references public.access_restrictions(id),
  action text not null check (action in ('created','note','lifted','same_person','different_person')),
  comment text not null check (length(comment) between 1 and 2000),
  actor_id uuid not null references auth.users(id),
  actor_label text not null,
  subject_key text,
  created_at timestamptz not null default now()
);
create index access_restriction_events_history on public.access_restriction_events(restriction_id, created_at);
create table public.access_restriction_exclusions (
  restriction_id uuid not null references public.access_restrictions(id),
  subject_key text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (restriction_id, subject_key)
);
create table public.access_restriction_managers (
  user_id uuid primary key references auth.users(id),
  granted_by uuid not null references auth.users(id),
  granted_at timestamptz not null default now()
);
create table public.access_restriction_permission_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  actor_id uuid not null references auth.users(id),
  granted boolean not null,
  created_at timestamptz not null default now()
);
alter table public.access_restrictions enable row level security;
alter table public.access_restriction_events enable row level security;
alter table public.access_restriction_exclusions enable row level security;
alter table public.access_restriction_managers enable row level security;
alter table public.access_restriction_permission_events enable row level security;
revoke all on public.access_restrictions, public.access_restriction_events,
  public.access_restriction_exclusions, public.access_restriction_managers,
  public.access_restriction_permission_events from public, anon, authenticated;
grant select, insert, update, delete on public.access_restrictions, public.access_restriction_events,
  public.access_restriction_exclusions, public.access_restriction_managers,
  public.access_restriction_permission_events to service_role;

-- A single transaction changes state and records its audit event. The API
-- authenticates the actor; the function independently checks their current role.
create function public.manage_access_restriction(p_actor uuid, p_action text, p_data jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_role text; v_label text; v_id uuid; v_row public.access_restrictions;
  v_comment text; v_keys text[]; v_match text[]; v_target uuid;
begin
  select role, coalesce(nullif(full_name,''), 'Staff') into v_role, v_label
    from public.team_members where user_id = p_actor;
  if v_role is null or v_role not in ('admin','team','front_desk') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_action = 'manager' then
    if v_role <> 'admin' then raise exception 'Owner/admin required' using errcode = '42501'; end if;
    v_target := (p_data->>'user_id')::uuid;
    if not exists(select 1 from public.team_members where user_id = v_target and role in ('team','front_desk')) then
      raise exception 'Select an eligible staff member';
    end if;
    if (p_data->>'enabled')::boolean then
      insert into public.access_restriction_managers(user_id, granted_by) values(v_target,p_actor)
        on conflict(user_id) do nothing;
    else
      delete from public.access_restriction_managers where user_id=v_target;
    end if;
    insert into public.access_restriction_permission_events(user_id,actor_id,granted)
      values(v_target,p_actor,(p_data->>'enabled')::boolean);
    return v_target;
  end if;
  v_comment := btrim(coalesce(p_data->>'comment',p_data->>'reason',''));
  if length(v_comment) not between 1 and 2000 then raise exception 'A reason or note is required'; end if;
  if p_action = 'create' then
    select coalesce(array_agg(value),'{}') into v_keys from jsonb_array_elements_text(p_data->'identity_keys');
    select coalesce(array_agg(value),'{}') into v_match from jsonb_array_elements_text(p_data->'match_keys');
    insert into public.access_restrictions(full_name,kind,reason,identifying_details,match_keys,identity_keys,expires_at,created_by)
      values(p_data->>'full_name',p_data->>'kind',p_data->>'reason',
        coalesce(p_data->>'identifying_details',''),v_match,v_keys,(p_data->>'expires_at')::timestamptz,p_actor)
      returning id into v_id;
    p_action := 'created';
  else
    v_id := (p_data->>'id')::uuid;
    select * into v_row from public.access_restrictions where id=v_id for update;
    if not found then raise exception 'Restriction not found'; end if;
    if p_action = 'lift' then
      if v_role <> 'admin' and not exists(select 1 from public.access_restriction_managers where user_id=p_actor) then
        raise exception 'Only authorized managers can lift restrictions' using errcode='42501';
      end if;
      if v_row.lifted_at is not null then raise exception 'Restriction already lifted'; end if;
      update public.access_restrictions set lifted_at=now(),lifted_by=p_actor,lift_reason=v_comment where id=v_id;
      p_action := 'lifted';
    elsif p_action in ('same_person','different_person') then
      if v_row.lifted_at is not null then raise exception 'Restriction is no longer active'; end if;
      select coalesce(array_agg(value),'{}') into v_keys from jsonb_array_elements_text(p_data->'identity_keys');
      if cardinality(v_keys)=0 or coalesce(p_data->>'subject_key','')='' then raise exception 'Subject required'; end if;
      if p_action='different_person' then
        if v_row.identity_keys && v_keys then
          raise exception 'Confirmed identity cannot be dismissed; manager must lift restriction' using errcode='42501';
        end if;
        insert into public.access_restriction_exclusions(restriction_id,subject_key,created_by)
          values(v_id,p_data->>'subject_key',p_actor) on conflict do nothing;
      else
        update public.access_restrictions set identity_keys =
          array(select distinct unnest(identity_keys || v_keys)) where id=v_id;
        delete from public.access_restriction_exclusions where restriction_id=v_id and subject_key=p_data->>'subject_key';
      end if;
    elsif p_action <> 'note' then
      raise exception 'Unknown action';
    end if;
  end if;
  insert into public.access_restriction_events(restriction_id,action,comment,actor_id,actor_label,subject_key)
    values(v_id,p_action,v_comment,p_actor,v_label,p_data->>'subject_key');
  return v_id;
end $$;
revoke all on function public.manage_access_restriction(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_access_restriction(uuid,text,jsonb) to service_role;
commit;
