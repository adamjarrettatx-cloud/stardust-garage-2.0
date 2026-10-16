-- Financial Write-Ups stay with the event's organizer and that organization's
-- main contact only.
--
-- partner_is_event_organizer() previously reused partner_event_contact_ids(),
-- which (with per-person Event sales access) also includes organization
-- people granted sales viewing. Settlement figures are more sensitive than
-- sales, so write-up access is now defined on its own and never follows the
-- sales-viewer toggle. partner_event_writeup() and the POS-proof route both
-- gate on this function.
create or replace function public.partner_is_event_organizer(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists(
    select 1
    from public.events e
    join public.contacts c on c.id = e.contact_id
    where e.id = p_event_id
      and public.partner_contact_id() is not null
      and not exists(select 1 from public.team_members t
        where t.user_id = auth.uid() and t.role in ('front_desk','calendar_viewer'))
      and c.contact_type && array['organization','event_organizer','collective']
      and (
        c.id = public.partner_contact_id()
        or (coalesce(c.status, 'active') <> 'archived'
          and exists(select 1 from public.organization_main_contacts m
            where m.organization_id = c.id and m.person_contact_id = public.partner_contact_id()))
      )
  );
$$;

revoke all on function public.partner_is_event_organizer(uuid) from public, anon;
grant execute on function public.partner_is_event_organizer(uuid) to authenticated;
