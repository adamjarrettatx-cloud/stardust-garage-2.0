-- Additive organization/person identity and one explicitly linked main contact.
-- No legacy contact, auth account, contract, booking, or signer is rewritten.
begin;
alter table public.contacts add column if not exists profile_kind text
  check (profile_kind in ('person', 'organization'));
alter table public.contacts drop constraint if exists contacts_contact_type_check;
alter table public.contacts add constraint contacts_contact_type_check check (contact_type <@ array[
  'dj','artist','performer','collective','promoter','venue_renter','vendor',
  'resident','event_organizer','other','organization','person'
]::text[]);

create or replace function public.contact_is_organization(p_contact public.contacts)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_contact.profile_kind,
    case when p_contact.entity_type = 'individual' then 'person'
      when p_contact.contact_type && array['organization','event_organizer','collective']
        then 'organization' else 'person' end) = 'organization';
$$;
revoke all on function public.contact_is_organization(public.contacts) from public;
grant execute on function public.contact_is_organization(public.contacts) to authenticated, service_role;

create table if not exists public.organization_main_contacts (
  organization_id uuid primary key references public.contacts(id) on delete restrict,
  person_contact_id uuid references public.contacts(id) on delete restrict,
  account_user_id uuid references auth.users(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(person_contact_id, account_user_id) <= 1),
  check (person_contact_id is distinct from organization_id)
);
create index if not exists organization_main_contacts_person_idx
  on public.organization_main_contacts(person_contact_id) where person_contact_id is not null;
create index if not exists organization_main_contacts_account_idx
  on public.organization_main_contacts(account_user_id) where account_user_id is not null;
alter table public.organization_main_contacts enable row level security;
-- Writes and reads use narrowly scoped, team-gated functions below.
revoke all on public.organization_main_contacts from anon, authenticated;
grant all on public.organization_main_contacts to service_role;

create or replace function public.guard_organization_profile_kind()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.contact_is_organization(new) and exists (
    select 1 from public.organization_main_contacts l where l.organization_id=new.id
      and (l.person_contact_id is not null or l.account_user_id is not null)
  ) then raise exception 'Remove the main contact before changing this organization to a person.' using errcode='23514'; end if;
  if public.contact_is_organization(new) and exists (
    select 1 from public.organization_main_contacts l where l.person_contact_id=new.id
  ) then raise exception 'This person is linked to an organization. Unlink them before changing their profile type.' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function public.guard_organization_profile_kind() from public;
drop trigger if exists guard_organization_profile_kind on public.contacts;
create trigger guard_organization_profile_kind before update of profile_kind,contact_type,entity_type
  on public.contacts for each row execute function public.guard_organization_profile_kind();

create or replace function public.search_organization_people(p_query text)
returns table(source text,id uuid,name text,email text,phone text,member_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare needle text;
begin
  if not exists(select 1 from public.team_members where user_id=auth.uid() and role in ('admin','team'))
    then raise exception 'Team access required.' using errcode='42501'; end if;
  if length(trim(p_query)) < 2 or length(p_query) > 120 then return; end if;
  needle := '%' || replace(replace(replace(trim(p_query), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  return query
    select r.source,r.id,r.name,r.email,r.phone,r.member_id from (
      select 'contact'::text source,c.id,c.display_name name,c.email,c.phone,null::uuid member_id
      from public.contacts c
      where c.status <> 'archived' and not public.contact_is_organization(c)
        and (c.display_name ilike needle or c.email ilike needle or c.phone ilike needle)
      union all
      select 'account'::text,u.id,
        coalesce(nullif(trim(m.full_name),''),nullif(trim(u.raw_user_meta_data->>'full_name'),''),u.email,u.phone,'Account'),
        u.email,u.phone,m.id
      from auth.users u
      left join lateral (select mp.id,mp.full_name from public.member_profiles mp where mp.user_id=u.id order by mp.created_at desc limit 1) m on true
      where u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
        and (u.email ilike needle or u.phone ilike needle or m.full_name ilike needle or u.raw_user_meta_data->>'full_name' ilike needle)
    ) r order by lower(r.name),r.source,r.id limit 50;
end $$;

create or replace function public.get_organization_main_contact(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare org public.contacts; link public.organization_main_contacts; person jsonb;
begin
  if not exists(select 1 from public.team_members where user_id=auth.uid() and role in ('admin','team'))
    then raise exception 'Team access required.' using errcode='42501'; end if;
  select * into org from public.contacts where id=p_organization_id;
  if org.id is null or not public.contact_is_organization(org) then
    raise exception 'Organization not found.' using errcode='P0002'; end if;
  select * into link from public.organization_main_contacts where organization_id=org.id;
  if link.person_contact_id is not null then
    select jsonb_build_object('source','contact','id',c.id,'name',c.display_name,'email',c.email,'phone',c.phone,'status',c.status)
      into person from public.contacts c where c.id=link.person_contact_id;
  elsif link.account_user_id is not null then
    select jsonb_build_object('source','account','id',u.id,
      'name',coalesce(nullif(trim(m.full_name),''),nullif(trim(u.raw_user_meta_data->>'full_name'),''),u.email,u.phone,'Account'),
      'email',u.email,'phone',u.phone,'member_id',m.id,
      'status',case when u.deleted_at is not null or u.banned_until>now() then 'unavailable' else 'active' end)
      into person from auth.users u
      left join lateral (select mp.id,mp.full_name from public.member_profiles mp where mp.user_id=u.id order by mp.created_at desc limit 1) m on true
      where u.id=link.account_user_id;
  end if;
  return jsonb_build_object('version',coalesce(link.version,0),'person',person);
end $$;

create or replace function public.set_organization_main_contact(
  p_organization_id uuid,p_mode text,p_person_id uuid default null,
  p_name text default null,p_email text default null,p_phone text default null,p_expected_version integer default 0
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare org public.contacts; candidate public.contacts; current_link public.organization_main_contacts;
  person_id uuid; account_id uuid; actor_email text; normalized_email text; before_state jsonb;
begin
  if not exists(select 1 from public.team_members where user_id=auth.uid() and role in ('admin','team'))
    then raise exception 'Team access required.' using errcode='42501'; end if;
  if p_mode is null or p_mode not in ('contact','account','create','clear') then
    raise exception 'Invalid main-contact action.' using errcode='22023'; end if;
  select * into org from public.contacts where id=p_organization_id for update;
  if org.id is null or not public.contact_is_organization(org) then
    raise exception 'Organization not found.' using errcode='P0002'; end if;
  if org.status='archived' then raise exception 'Restore the organization before changing its main contact.' using errcode='23514'; end if;
  select * into current_link from public.organization_main_contacts where organization_id=org.id;
  if p_expected_version is null or p_expected_version <> coalesce(current_link.version,0) then
    raise exception 'The main contact changed. Refresh and try again.' using errcode='40001'; end if;
  before_state := public.get_organization_main_contact(org.id)->'person';
  select email into actor_email from auth.users where id=auth.uid();
  if p_mode='contact' then
    select * into candidate from public.contacts where id=p_person_id for update;
    if candidate.id is null or candidate.id=org.id or public.contact_is_organization(candidate) or candidate.status='archived' then
      raise exception 'Choose a non-archived person contact.' using errcode='22023'; end if;
    person_id := candidate.id;
  elsif p_mode='account' then
    select id into account_id from auth.users where id=p_person_id and deleted_at is null
      and (banned_until is null or banned_until <= now()) for share;
    if account_id is null then raise exception 'Account unavailable. Choose another person.' using errcode='22023'; end if;
  elsif p_mode='create' then
    normalized_email := nullif(lower(trim(p_email)),'');
    if nullif(trim(p_name),'') is null or length(trim(p_name))>200 or length(coalesce(p_phone,''))>50
      or (normalized_email is not null and (length(normalized_email)>254 or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
      then raise exception 'Enter a valid name, email and phone.' using errcode='22023'; end if;
    if normalized_email is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(normalized_email,0));
      if exists(select 1 from public.contacts c where lower(trim(c.email))=normalized_email and not public.contact_is_organization(c))
        or exists(select 1 from auth.users u where lower(trim(u.email))=normalized_email)
        then raise exception 'A contact or account already uses this email. Search for that person instead, or restore their archived contact.' using errcode='23505'; end if;
    end if;
    insert into public.contacts(display_name,contact_type,profile_kind,email,phone,status,created_by,updated_by)
      values(trim(p_name),array['person'],'person',normalized_email,nullif(trim(p_phone),''),'active',auth.uid(),auth.uid())
      returning id into person_id;
    insert into public.contact_audit_log(contact_id,action,actor_id,actor_email,details)
      values(person_id,'create',auth.uid(),actor_email,jsonb_build_object('display_name',trim(p_name),'contact_type',array['person'],'organization_id',org.id));
  end if;
  insert into public.organization_main_contacts(organization_id,person_contact_id,account_user_id,version,updated_by)
    values(org.id,person_id,account_id,coalesce(current_link.version,0)+1,auth.uid())
    on conflict(organization_id) do update set person_contact_id=excluded.person_contact_id,
      account_user_id=excluded.account_user_id,version=excluded.version,updated_by=excluded.updated_by,updated_at=now();
  insert into public.contact_audit_log(contact_id,action,actor_id,actor_email,details)
    values(org.id,'update',auth.uid(),actor_email,jsonb_build_object('changed',jsonb_build_object('main_contact',jsonb_build_object(
      'from',before_state,'to',public.get_organization_main_contact(org.id)->'person'))));
  return public.get_organization_main_contact(org.id);
end $$;
revoke all on function public.search_organization_people(text) from public,anon;
revoke all on function public.get_organization_main_contact(uuid) from public,anon;
revoke all on function public.set_organization_main_contact(uuid,text,uuid,text,text,text,integer) from public,anon;
grant execute on function public.search_organization_people(text) to authenticated;
grant execute on function public.get_organization_main_contact(uuid) to authenticated;
grant execute on function public.set_organization_main_contact(uuid,text,uuid,text,text,text,integer) to authenticated;
commit;
