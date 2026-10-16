begin;
-- Event sales viewers: any number of people linked to an organization can be
-- allowed to see that organization's events and sales in My Events.
--
-- * organization_people.can_view_event_sales (default off). Linking a person
--   still grants nothing by itself; an admin turns this on per person.
-- * Grants exactly what the main contact already gets: My Events, live ticket
--   counts and the buyer list (names, purchaser email, tier, time). Guest list,
--   pay and contract rights are unchanged and still keyed on the person's own
--   contact only.
-- * The person needs their own partner login (invite from their Person
--   profile). Access stops when the toggle is turned off, the person is
--   unlinked, the organization is archived, or their login is disabled.
-- * Every change is written to contact_audit_log on both profiles.

alter table public.organization_people
  add column if not exists can_view_event_sales boolean not null default false,
  add column if not exists sales_access_changed_by uuid references auth.users(id) on delete set null,
  add column if not exists sales_access_changed_at timestamptz;

create index if not exists organization_people_sales_viewer_idx
  on public.organization_people(person_contact_id) where can_view_event_sales;

-- Contacts whose events the current partner may view: their own events-capable
-- contact, organizations they are the main contact of, and organizations that
-- list them as an additional person with event sales access.
create or replace function public.partner_event_contact_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select c.id from public.contacts c
  where public.partner_contact_id() is not null
    and not exists(select 1 from public.team_members t
      where t.user_id = auth.uid() and t.role in ('front_desk','calendar_viewer'))
    and c.contact_type && array['organization','event_organizer','collective']
    and (
      c.id = public.partner_contact_id()
      or (coalesce(c.status, 'active') <> 'archived' and (
        exists(select 1 from public.organization_main_contacts m
          where m.organization_id = c.id and m.person_contact_id = public.partner_contact_id())
        or exists(select 1 from public.organization_people p
          where p.organization_id = c.id and p.person_contact_id = public.partner_contact_id()
            and p.can_view_event_sales)
      ))
    );
$$;
revoke all on function public.partner_event_contact_ids() from public, anon;
grant execute on function public.partner_event_contact_ids() to authenticated, service_role;

-- Navigation hint for the portal (My Events link). partner_has_event() remains
-- authoritative for every read.
drop function if exists public.partner_self();
create function public.partner_self()
returns table(id uuid, contact_id uuid, full_name text, photo_url text, is_active boolean,
  invited_at timestamptz, activated_at timestamptz, contact_display_name text, contact_type jsonb,
  manages_event_organization boolean)
language sql stable security definer set search_path to 'public', 'auth' as $$
  select p.id, p.contact_id, p.full_name, p.photo_url, p.is_active,
         p.invited_at, p.activated_at, c.display_name, to_jsonb(c.contact_type),
         exists(select 1 from public.contacts o
           where o.contact_type && array['organization','event_organizer','collective']
             and coalesce(o.status, 'active') <> 'archived'
             and (exists(select 1 from public.organization_main_contacts m
                    where m.organization_id = o.id and m.person_contact_id = p.contact_id)
               or exists(select 1 from public.organization_people op
                    where op.organization_id = o.id and op.person_contact_id = p.contact_id
                      and op.can_view_event_sales)))
  from public.partner_profiles p
  join public.contacts c on c.id = p.contact_id
  where p.user_id = auth.uid();
$$;
revoke all on function public.partner_self() from public;
grant execute on function public.partner_self() to authenticated, service_role;

-- Team list now carries the sales flag and each person's portal login state so
-- the profile can show whether access will actually work.
create or replace function public.get_organization_people(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare org public.contacts;
begin
  perform public._require_contacts_team();
  select * into org from public.contacts where id=p_organization_id;
  if org.id is null or not public.contact_is_organization(org) then
    raise exception 'Organization not found.' using errcode='P0002'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('link_id',p.id,'id',c.id,'name',c.display_name,
      'email',c.email,'phone',c.phone,'status',c.status,'role',p.role,
      'can_view_event_sales',p.can_view_event_sales,
      'sales_access_changed_at',p.sales_access_changed_at,
      'portal',case when pp.id is null then 'none'
        when pp.is_active then 'active'
        when pp.activated_at is not null then 'disabled'
        else 'invited' end) order by p.created_at,p.id)
    from public.organization_people p join public.contacts c on c.id=p.person_contact_id
    left join public.partner_profiles pp on pp.contact_id=c.id
    where p.organization_id=org.id),'[]'::jsonb);
end $$;
revoke all on function public.get_organization_people(uuid) from public, anon;
grant execute on function public.get_organization_people(uuid) to authenticated;

-- Admin-only: this discloses buyer names and emails, so it follows the same
-- authority as sending a partner invite.
create or replace function public.set_organization_person_sales_access(p_link_id uuid, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare link public.organization_people; org public.contacts; person_name text; actor_email text;
begin
  if not exists(select 1 from public.team_members where user_id=auth.uid() and role='admin') then
    raise exception 'Only an admin can change event sales access.' using errcode='42501'; end if;
  if p_enabled is null then raise exception 'Choose on or off.' using errcode='22023'; end if;
  select * into link from public.organization_people where id=p_link_id for update;
  if link.id is null then raise exception 'This person is no longer linked. Refresh and try again.' using errcode='P0002'; end if;
  select * into org from public.contacts where id=link.organization_id;
  if org.status='archived' then raise exception 'Restore the organization before changing its people.' using errcode='23514'; end if;
  if link.can_view_event_sales is distinct from p_enabled then
    update public.organization_people
      set can_view_event_sales=p_enabled, sales_access_changed_by=auth.uid(), sales_access_changed_at=now(),
          updated_by=auth.uid(), updated_at=now()
      where id=link.id;
    select display_name into person_name from public.contacts where id=link.person_contact_id;
    select email into actor_email from auth.users where id=auth.uid();
    insert into public.contact_audit_log(contact_id,action,actor_id,actor_email,details) values
      (org.id,'update',auth.uid(),actor_email,jsonb_build_object('changed',jsonb_build_object(
        'event_sales_access',jsonb_build_object('person_id',link.person_contact_id,'name',person_name,'from',link.can_view_event_sales,'to',p_enabled)))),
      (link.person_contact_id,'update',auth.uid(),actor_email,jsonb_build_object('changed',jsonb_build_object(
        'event_sales_access',jsonb_build_object('organization_id',org.id,'organization_name',org.display_name,'from',link.can_view_event_sales,'to',p_enabled))));
  end if;
  return public.get_organization_people(org.id);
end $$;
revoke all on function public.set_organization_person_sales_access(uuid,boolean) from public, anon;
grant execute on function public.set_organization_person_sales_access(uuid,boolean) to authenticated;
commit;
