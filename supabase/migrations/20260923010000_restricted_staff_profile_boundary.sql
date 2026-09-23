-- Restricted workstation roles must not inherit the broad customer-directory
-- visibility intended for normal team members and administrators.
drop policy if exists free_accounts_team_read on public.free_accounts;
create policy free_accounts_team_read
  on public.free_accounts
  for select
  using (public.is_team());
