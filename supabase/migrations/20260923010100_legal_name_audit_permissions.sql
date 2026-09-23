begin;
-- Supabase default privileges grant service_role broader table access.
-- Explicitly revoke those defaults so correction history is append-only.
revoke all on public.legal_name_corrections from service_role;
grant select, insert on public.legal_name_corrections to service_role;
commit;
