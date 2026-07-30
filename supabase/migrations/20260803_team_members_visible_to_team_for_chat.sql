-- Team Chat DM sidebar needs every signed-in team member to see the rest of
-- the roster (name/email) so they can click a teammate and start a DM, not
-- just admins. Previously team_members had only:
--   * "Team members can read own record" (SELECT where user_id = auth.uid())
--   * "Admins can manage team members" (ALL where is_admin())
-- so a non-admin ('team' role) querying `.neq('user_id', currentUserId)`
-- always got zero rows -- their DM list was empty. This adds a permissive
-- SELECT policy so any team member (admin or team) can read the roster.
-- Writes stay admin-only via the existing "Admins can manage team members"
-- policy -- this migration only adds read access.

create policy "Team members can view team roster" on public.team_members
  for select
  to public
  using (public.is_team_member());
