-- Lets any team member (not just admins) resolve creator display names for
-- the Team Calendar leaderboard, without opening up direct SELECT access to
-- the full team_members table (which stays admin-only / own-row-only per
-- 20260727_rls_security_hardening.sql).
--
-- SECURITY DEFINER bypasses RLS internally, but the `where public.is_team_member()`
-- clause means a caller who isn't logged in as a team member gets an empty
-- result set rather than an error or someone else's data.
create or replace function public.team_creator_names()
returns table (user_id uuid, display_name text)
language sql
security definer
set search_path = 'public'
as $$
  select tm.user_id, coalesce(nullif(tm.full_name, ''), tm.email) as display_name
  from public.team_members tm
  where public.is_team_member()
    and tm.user_id is not null;
$$;

grant execute on function public.team_creator_names() to authenticated;
