-- Partner + customer records may coexist. Restricted workstation roles retain
-- their original narrow scope even if a partner row is accidentally attached.
-- All partner grants, bookings and contracts RPCs delegate to this function.
create or replace function public.partner_contact_id()
returns uuid
language sql stable security definer
set search_path = public, auth
as $$
  select p.contact_id
  from public.partner_profiles p
  where p.user_id = auth.uid()
    and p.is_active
    and not exists (
      select 1 from public.team_members tm
      where tm.user_id = auth.uid()
        and tm.role in ('calendar_viewer', 'front_desk')
    )
  limit 1;
$$;
revoke all on function public.partner_contact_id() from public;
grant execute on function public.partner_contact_id() to authenticated;
