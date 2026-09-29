-- Supabase production default privileges grant service_role ALL on new tables.
-- Explicitly replace those defaults: the server may append/read, not rewrite,
-- delete, truncate, or attach triggers to the private security history.
begin;
revoke all on public.security_incidents,public.security_warning_reminders from service_role;
grant select,insert on public.security_incidents,public.security_warning_reminders to service_role;
commit;
