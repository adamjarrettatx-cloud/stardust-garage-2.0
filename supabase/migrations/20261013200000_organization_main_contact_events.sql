begin;
-- My Events access for an organization's main contact.
--
-- A partner login is tied to one contact. When that contact is a Person who is
-- recorded as the main contact of an Organization / Event Organizer /
-- Collective (organization_main_contacts.person_contact_id), the login now sees
-- that organization's events and sales exactly as the organization itself
-- would. Nothing else is widened: guest list, pay, contracts and every RLS
-- policy keyed on partner_contact_id() are unchanged, and the names-only
-- disclosure boundary in partner_event_attendees() is untouched.

-- Contacts whose events the current partner may view: their own contact (when
-- it is an events-capable type) plus every events-capable, non-archived
-- organization they are the main contact of. (An archived organization stops
-- sharing through its main contact; the organization's own login is unchanged.)
create or replace function public.partner_event_contact_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select c.id from public.contacts c
  where public.partner_contact_id() is not null
    and not exists(select 1 from public.team_members t
      where t.user_id = auth.uid() and t.role in ('front_desk','calendar_viewer'))
    and c.contact_type && array['organization','event_organizer','collective']
    and (
      c.id = public.partner_contact_id()
      or (coalesce(c.status, 'active') <> 'archived' and exists(select 1 from public.organization_main_contacts m
        where m.organization_id = c.id and m.person_contact_id = public.partner_contact_id()))
    );
$$;
revoke all on function public.partner_event_contact_ids() from public, anon;
grant execute on function public.partner_event_contact_ids() to authenticated, service_role;

create or replace function public.partner_has_capability(p_capability text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_capability = 'events' then exists(select 1 from public.partner_event_contact_ids())
    else coalesce((
      select case p_capability
        when 'guestList' then c.contact_type && array['dj','artist','performer','resident','organization','event_organizer','collective','promoter']
        when 'pay' then c.contact_type && array['dj','artist','performer','resident']
        when 'contracts' then c.contact_type && array['dj','artist','performer','resident','organization','event_organizer','collective','venue_renter','vendor']
        else false end
      from public.contacts c where c.id = public.partner_contact_id()
        and not exists(select 1 from public.team_members t where t.user_id=auth.uid() and t.role in ('front_desk','calendar_viewer'))
    ), false)
  end;
$$;

create or replace function public.partner_has_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with ids as (select id from public.partner_event_contact_ids() as id)
  select exists(select 1 from ids) and exists(
    select 1 from public.events e where e.id = p_event_id and (
      e.contact_id in (select id from ids)
      or exists(select 1 from public.event_guestlist_grants g where g.event_id = e.id and g.contact_id in (select id from ids))
      or exists(select 1 from public.event_bookings b where b.event_id = e.id and b.contact_id in (select id from ids) and b.status <> 'cancelled')
      or exists(select 1 from public.document_contracts c where c.event_id = e.id
        and c.status not in ('draft','voided','cancelled')
        and (c.contact_id in (select id from ids) or c.collective_contact_id in (select id from ids)))
    )
  );
$$;

-- partner_self gains one boolean so the website can show My Events. Adding an
-- output column changes the return type, so the function is recreated.
drop function if exists public.partner_self();
create function public.partner_self()
returns table(id uuid, contact_id uuid, full_name text, photo_url text, is_active boolean,
  invited_at timestamptz, activated_at timestamptz, contact_display_name text, contact_type jsonb,
  manages_event_organization boolean)
language sql stable security definer set search_path to 'public', 'auth' as $$
  select p.id, p.contact_id, p.full_name, p.photo_url, p.is_active,
         p.invited_at, p.activated_at, c.display_name, to_jsonb(c.contact_type),
         exists(select 1 from public.organization_main_contacts m
           join public.contacts o on o.id = m.organization_id
           where m.person_contact_id = p.contact_id
             and o.contact_type && array['organization','event_organizer','collective']
             and coalesce(o.status, 'active') <> 'archived')
  from public.partner_profiles p
  join public.contacts c on c.id = p.contact_id
  where p.user_id = auth.uid();
$$;
revoke all on function public.partner_self() from public;
grant execute on function public.partner_self() to authenticated, service_role;
commit;
