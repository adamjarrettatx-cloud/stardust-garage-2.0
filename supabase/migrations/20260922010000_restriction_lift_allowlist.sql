-- Owner-approved lift access: Adam Jarrett, Naish Kulpath, Jeyu Bigelow.
-- General administrator status must not bypass this capability.
begin;
alter table public.access_restriction_managers
  add column can_manage_permissions boolean not null default false;

do $$
declare v_owner uuid;
begin
  if (select count(*) from public.team_members where lower(email) in
      ('adam@sdgatx.com','naish@sdgatx.com','jeyu@sdgatx.com')
      and role='admin' and user_id is not null) <> 3 then
    raise exception 'Expected exactly three verified administrator accounts';
  end if;
  select user_id into strict v_owner from public.team_members where lower(email)='adam@sdgatx.com' and role='admin';
  insert into public.access_restriction_permission_events(user_id,actor_id,granted)
    select m.user_id,v_owner,false from public.access_restriction_managers m
    where not exists(select 1 from public.team_members t where t.user_id=m.user_id
      and lower(t.email) in ('adam@sdgatx.com','naish@sdgatx.com','jeyu@sdgatx.com'));
  delete from public.access_restriction_managers m where not exists(
    select 1 from public.team_members t where t.user_id=m.user_id
      and lower(t.email) in ('adam@sdgatx.com','naish@sdgatx.com','jeyu@sdgatx.com'));
  insert into public.access_restriction_managers(user_id,granted_by,can_manage_permissions)
    select user_id,v_owner,user_id=v_owner from public.team_members
    where lower(email) in ('adam@sdgatx.com','naish@sdgatx.com','jeyu@sdgatx.com') and role='admin'
    on conflict(user_id) do update set granted_by=excluded.granted_by,
      can_manage_permissions=excluded.can_manage_permissions;
  insert into public.access_restriction_permission_events(user_id,actor_id,granted)
    select user_id,v_owner,true from public.access_restriction_managers;
end $$;

-- Preserve the tested admission/note operations; replace only the authority
-- checks in the existing function. Abort on drift rather than patching an
-- unexpected definition or silently retaining an administrator bypass.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.manage_access_restriction(uuid,text,jsonb)'::regprocedure);
  if position('if v_role <> ''admin'' then raise exception ''Owner/admin required''' in definition)=0
    or position('if v_role <> ''admin'' and not exists(select 1 from public.access_restriction_managers where user_id=p_actor) then' in definition)=0
    or position('role in (''team'',''front_desk'')' in definition)=0 then
    raise exception 'Unexpected access-restriction function definition; review before migration';
  end if;
  definition := replace(definition,
    'if v_role <> ''admin'' then raise exception ''Owner/admin required''',
    'if not exists(select 1 from public.access_restriction_managers where user_id=p_actor and can_manage_permissions) then raise exception ''Owner permission required''');
  definition := replace(definition,
    'if v_role <> ''admin'' and not exists(select 1 from public.access_restriction_managers where user_id=p_actor) then',
    'if not exists(select 1 from public.access_restriction_managers where user_id=p_actor) then');
  definition := replace(definition, 'role in (''team'',''front_desk'')', 'role in (''admin'',''team'',''front_desk'')');
  definition := replace(definition,
    'delete from public.access_restriction_managers where user_id=v_target;',
    'if exists(select 1 from public.access_restriction_managers where user_id=v_target and can_manage_permissions) then raise exception ''Owner permission cannot be removed here'' using errcode=''42501''; end if;
      delete from public.access_restriction_managers where user_id=v_target;');
  execute definition;
end $$;
commit;
