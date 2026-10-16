-- Organization people: every additional contact on an organization is a real
-- Person profile linked to that organization with a role.
--
-- * New table organization_people(organization_id, person_contact_id, role).
-- * Free-text additional_contacts written to an organization (new-contact form,
--   legacy clients) are converted into linked Person profiles by trigger, and
--   the converted entries are removed from the JSON so they are never
--   converted twice. The original JSON is preserved in contact_audit_log.
-- * Existing organization additional_contacts are converted once at the end.
-- * Person profiles (non-organizations) keep their additional_contacts as-is.
-- * Linking a person grants no login, portal access, or signing authority.
begin;

create table if not exists public.organization_people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.contacts(id) on delete cascade,
  person_contact_id uuid not null references public.contacts(id) on delete cascade,
  role text check (role is null or length(role) <= 100),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, person_contact_id),
  check (organization_id <> person_contact_id)
);
create index if not exists organization_people_person_idx on public.organization_people(person_contact_id);
alter table public.organization_people enable row level security;
-- Reads and writes go through the team-gated functions below.
revoke all on public.organization_people from anon, authenticated;
grant all on public.organization_people to service_role;

-- Profile-kind guard now also covers additional organization people.
create or replace function public.guard_organization_profile_kind()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.contact_is_organization(new) and (exists (
      select 1 from public.organization_main_contacts l where l.organization_id=new.id
        and (l.person_contact_id is not null or l.account_user_id is not null))
    or exists (select 1 from public.organization_people p where p.organization_id=new.id))
  then raise exception 'Remove the organization''s linked people before changing it to a person.' using errcode='23514'; end if;
  if public.contact_is_organization(new) and (exists (
      select 1 from public.organization_main_contacts l where l.person_contact_id=new.id)
    or exists (select 1 from public.organization_people p where p.person_contact_id=new.id))
  then raise exception 'This person is linked to an organization. Unlink them before changing their profile type.' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function public.guard_organization_profile_kind() from public;

create or replace function public._require_contacts_team()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.team_members where user_id=auth.uid() and role in ('admin','team'))
    then raise exception 'Team access required.' using errcode='42501'; end if;
end $$;
revoke all on function public._require_contacts_team() from public, anon, authenticated;

-- Internal: find-or-create the person and link them. Reuses an existing person
-- only when both name and email match, so a shared organization inbox never
-- merges two different people. Callers handle authorization.
create or replace function public._link_organization_person(
  p_organization_id uuid, p_name text, p_email text, p_phone text, p_role text, p_source text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare person_id uuid; created boolean := false; link_id uuid; org_name text;
  v_name text := left(nullif(trim(p_name),''),200);
  v_email text := nullif(lower(trim(p_email)),'');
  v_phone text := nullif(trim(p_phone),'');
  v_role text := left(nullif(trim(p_role),''),100);
  actor_email text;
begin
  if v_name is null then raise exception 'Enter the person''s name.' using errcode='22023'; end if;
  select display_name into org_name from public.contacts where id=p_organization_id;
  select email into actor_email from auth.users where id=auth.uid();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('org-person:'||lower(v_name)||':'||coalesce(v_email,''),0));
  if v_email is not null then
    select c.id into person_id from public.contacts c
      where lower(trim(c.email))=v_email and lower(trim(c.display_name))=lower(v_name)
        and not public.contact_is_organization(c)
      order by (c.status='archived'), c.created_at limit 1;
  end if;
  if person_id is null then
    insert into public.contacts(display_name,contact_type,profile_kind,email,phone,status,created_by,updated_by)
      values(v_name,array['person'],'person',v_email,v_phone,'active',auth.uid(),auth.uid())
      returning id into person_id;
    created := true;
    insert into public.contact_audit_log(contact_id,action,actor_id,actor_email,details)
      values(person_id,'create',auth.uid(),actor_email,jsonb_build_object('display_name',v_name,
        'contact_type',array['person'],'organization_id',p_organization_id,'source',p_source));
  elsif v_phone is not null then
    update public.contacts set phone=v_phone where id=person_id and nullif(trim(phone),'') is null;
  end if;
  insert into public.organization_people(organization_id,person_contact_id,role,created_by,updated_by)
    values(p_organization_id,person_id,v_role,auth.uid(),auth.uid())
    on conflict(organization_id,person_contact_id) do update
      set role=coalesce(excluded.role,public.organization_people.role),updated_by=excluded.updated_by,updated_at=now()
    returning id into link_id;
  insert into public.contact_audit_log(contact_id,action,actor_id,actor_email,details) values
    (p_organization_id,'link_added',auth.uid(),actor_email,jsonb_build_object('person_id',person_id,'name',v_name,'role',v_role,'source',p_source)),
    (person_id,'link_added',auth.uid(),actor_email,jsonb_build_object('organization_id',p_organization_id,'organization_name',org_name,'role',v_role,'source',p_source));
  return jsonb_build_object('link_id',link_id,'person_id',person_id,'created',created);
end $$;
revoke all on function public._link_organization_person(uuid,text,text,text,text,text) from public, anon, authenticated;

-- Internal: convert one organization's free-text additional contacts.
create or replace function public._convert_organization_additional_contacts(p_organization_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare org public.contacts; entry jsonb; v_name text; converted integer := 0; actor_email text;
begin
  select * into org from public.contacts where id=p_organization_id for update;
  if org.id is null or not public.contact_is_organization(org)
    or jsonb_typeof(org.additional_contacts) is distinct from 'array'
    or jsonb_array_length(org.additional_contacts)=0 then return 0; end if;
  for entry in select value from jsonb_array_elements(org.additional_contacts) loop
    if jsonb_typeof(entry) <> 'object' then continue; end if;
    v_name := coalesce(nullif(trim(entry->>'name'),''),nullif(trim(entry->>'email'),''),nullif(trim(entry->>'phone'),''));
    if v_name is null then continue; end if;
    perform public._link_organization_person(org.id,v_name,entry->>'email',entry->>'phone',entry->>'role','additional_contacts');
    converted := converted + 1;
  end loop;
  select email into actor_email from auth.users where id=auth.uid();
  insert into public.contact_audit_log(contact_id,action,actor_id,actor_email,details)
    values(org.id,'update',auth.uid(),actor_email,jsonb_build_object('converted_additional_contacts',org.additional_contacts));
  update public.contacts set additional_contacts='[]'::jsonb where id=org.id;
  return converted;
end $$;
revoke all on function public._convert_organization_additional_contacts(uuid) from public, anon, authenticated;

create or replace function public.convert_organization_additional_contacts_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if pg_catalog.pg_trigger_depth() > 1 then return null; end if;
  if public.contact_is_organization(new) and jsonb_typeof(new.additional_contacts)='array'
    and jsonb_array_length(new.additional_contacts) > 0 then
    perform public._convert_organization_additional_contacts(new.id);
  end if;
  return null;
end $$;
revoke all on function public.convert_organization_additional_contacts_trigger() from public;
drop trigger if exists convert_organization_additional_contacts on public.contacts;
create trigger convert_organization_additional_contacts
  after insert or update of additional_contacts,profile_kind,contact_type,entity_type on public.contacts
  for each row execute function public.convert_organization_additional_contacts_trigger();

-- Team-gated API ------------------------------------------------------------

create or replace function public.get_organization_people(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare org public.contacts;
begin
  perform public._require_contacts_team();
  select * into org from public.contacts where id=p_organization_id;
  if org.id is null or not public.contact_is_organization(org) then
    raise exception 'Organization not found.' using errcode='P0002'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('link_id',p.id,'id',c.id,'name',c.display_name,
      'email',c.email,'phone',c.phone,'status',c.status,'role',p.role) order by p.created_at,p.id)
    from public.organization_people p join public.contacts c on c.id=p.person_contact_id
    where p.organization_id=org.id),'[]'::jsonb);
end $$;

create or replace function public.add_organization_person(
  p_organization_id uuid, p_mode text, p_person_id uuid default null,
  p_name text default null, p_email text default null, p_phone text default null, p_role text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare org public.contacts; candidate public.contacts; v_email text; v_name text; v_role text;
  link_id uuid; actor_email text;
begin
  perform public._require_contacts_team();
  if p_mode is null or p_mode not in ('contact','account','create') then
    raise exception 'Invalid action.' using errcode='22023'; end if;
  select * into org from public.contacts where id=p_organization_id for update;
  if org.id is null or not public.contact_is_organization(org) then
    raise exception 'Organization not found.' using errcode='P0002'; end if;
  if org.status='archived' then raise exception 'Restore the organization before changing its people.' using errcode='23514'; end if;
  v_role := nullif(trim(p_role),'');
  if length(coalesce(v_role,''))>100 then raise exception 'Enter a role of 100 characters or fewer.' using errcode='22023'; end if;
  if p_mode='contact' then
    select * into candidate from public.contacts where id=p_person_id for update;
    if candidate.id is null or candidate.id=org.id or public.contact_is_organization(candidate) or candidate.status='archived' then
      raise exception 'Choose a non-archived person contact.' using errcode='22023'; end if;
    if exists(select 1 from public.organization_people where organization_id=org.id and person_contact_id=candidate.id) then
      raise exception '% is already linked to this organization.', candidate.display_name using errcode='23505'; end if;
    select email into actor_email from auth.users where id=auth.uid();
    insert into public.organization_people(organization_id,person_contact_id,role,created_by,updated_by)
      values(org.id,candidate.id,v_role,auth.uid(),auth.uid()) returning id into link_id;
    insert into public.contact_audit_log(contact_id,action,actor_id,actor_email,details) values
      (org.id,'link_added',auth.uid(),actor_email,jsonb_build_object('person_id',candidate.id,'name',candidate.display_name,'role',v_role,'source','select')),
      (candidate.id,'link_added',auth.uid(),actor_email,jsonb_build_object('organization_id',org.id,'organization_name',org.display_name,'role',v_role,'source','select'));
  else
    if p_mode='account' then
      select coalesce(nullif(trim(m.full_name),''),nullif(trim(u.raw_user_meta_data->>'full_name'),''),u.email,u.phone),u.email
        into v_name,v_email from auth.users u
        left join lateral (select mp.full_name from public.member_profiles mp where mp.user_id=u.id order by mp.created_at desc limit 1) m on true
        where u.id=p_person_id and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now());
      if v_name is null then raise exception 'Account unavailable. Choose another person.' using errcode='22023'; end if;
      p_phone := null;
    else
      v_name := nullif(trim(p_name),''); v_email := nullif(lower(trim(p_email)),'');
      if v_name is null or length(v_name)>200 or length(coalesce(p_phone,''))>50
        or (v_email is not null and (length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
        then raise exception 'Enter a valid name, email and phone.' using errcode='22023'; end if;
    end if;
    perform public._link_organization_person(org.id,v_name,v_email,p_phone,v_role,p_mode);
  end if;
  return public.get_organization_people(org.id);
end $$;

create or replace function public.update_organization_person(p_link_id uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare link public.organization_people; org public.contacts; v_role text := nullif(trim(p_role),''); actor_email text;
begin
  perform public._require_contacts_team();
  if length(coalesce(v_role,''))>100 then raise exception 'Enter a role of 100 characters or fewer.' using errcode='22023'; end if;
  select * into link from public.organization_people where id=p_link_id for update;
  if link.id is null then raise exception 'This person is no longer linked. Refresh and try again.' using errcode='P0002'; end if;
  select * into org from public.contacts where id=link.organization_id;
  if org.status='archived' then raise exception 'Restore the organization before changing its people.' using errcode='23514'; end if;
  if link.role is distinct from v_role then
    update public.organization_people set role=v_role,updated_by=auth.uid(),updated_at=now() where id=link.id;
    select email into actor_email from auth.users where id=auth.uid();
    insert into public.contact_audit_log(contact_id,action,actor_id,actor_email,details)
      values(org.id,'update',auth.uid(),actor_email,jsonb_build_object('changed',jsonb_build_object(
        'person_role',jsonb_build_object('person_id',link.person_contact_id,'from',link.role,'to',v_role))));
  end if;
  return public.get_organization_people(org.id);
end $$;

create or replace function public.remove_organization_person(p_link_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare link public.organization_people; org public.contacts; person_name text; actor_email text;
begin
  perform public._require_contacts_team();
  select * into link from public.organization_people where id=p_link_id for update;
  if link.id is null then raise exception 'This person is no longer linked. Refresh and try again.' using errcode='P0002'; end if;
  select * into org from public.contacts where id=link.organization_id;
  if org.status='archived' then raise exception 'Restore the organization before changing its people.' using errcode='23514'; end if;
  select display_name into person_name from public.contacts where id=link.person_contact_id;
  delete from public.organization_people where id=link.id;
  select email into actor_email from auth.users where id=auth.uid();
  insert into public.contact_audit_log(contact_id,action,actor_id,actor_email,details) values
    (org.id,'link_removed',auth.uid(),actor_email,jsonb_build_object('person_id',link.person_contact_id,'name',person_name,'role',link.role)),
    (link.person_contact_id,'link_removed',auth.uid(),actor_email,jsonb_build_object('organization_id',org.id,'organization_name',org.display_name,'role',link.role));
  return public.get_organization_people(org.id);
end $$;

-- Organizations a person belongs to, as main contact and/or linked person.
create or replace function public.get_person_organizations(p_person_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_contacts_team();
  return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.display_name,'status',o.status,
      'role',r.role,'main_contact',r.main_contact) order by lower(o.display_name),o.id)
    from (select organization_id,max(role) role,bool_or(main_contact) main_contact from (
        select p.organization_id,p.role,false main_contact from public.organization_people p where p.person_contact_id=p_person_id
        union all
        select l.organization_id,null,true from public.organization_main_contacts l where l.person_contact_id=p_person_id
      ) x group by organization_id) r
    join public.contacts o on o.id=r.organization_id),'[]'::jsonb);
end $$;

revoke all on function public.get_organization_people(uuid) from public, anon;
revoke all on function public.add_organization_person(uuid,text,uuid,text,text,text,text) from public, anon;
revoke all on function public.update_organization_person(uuid,text) from public, anon;
revoke all on function public.remove_organization_person(uuid) from public, anon;
revoke all on function public.get_person_organizations(uuid) from public, anon;
grant execute on function public.get_organization_people(uuid) to authenticated;
grant execute on function public.add_organization_person(uuid,text,uuid,text,text,text,text) to authenticated;
grant execute on function public.update_organization_person(uuid,text) to authenticated;
grant execute on function public.remove_organization_person(uuid) to authenticated;
grant execute on function public.get_person_organizations(uuid) to authenticated;

-- One-time conversion of existing organization additional contacts.
do $$
declare r record;
begin
  for r in select c.id from public.contacts c
    where public.contact_is_organization(c) and jsonb_typeof(c.additional_contacts)='array'
      and jsonb_array_length(c.additional_contacts) > 0
  loop perform public._convert_organization_additional_contacts(r.id); end loop;
end $$;

commit;
