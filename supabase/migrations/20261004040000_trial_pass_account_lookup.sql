-- Trial SDG Pass: every pass gets an account.
--
-- 1. auth_user_by_email(p_email)
--    Server-side lookup of an auth user by email. The front-desk account path
--    used auth.admin.listUsers(), which in production failed with GoTrue's
--    "Database error finding users" on every call since 2026-09-20, so no
--    front-desk pass was ever linked. A single indexed read replaces the
--    paginated scan. Returns only what the caller needs to decide between
--    "link", "create" and "claim": id, whether a password was ever set, and
--    whether this platform provisioned the account for a Trial Pass.
--    Service role only.
--
-- 2. trial_passes.account_link_attempted_at / account_link_error
--    Bookkeeping for the account sweep cron so a pass whose email Auth
--    refuses is retried daily rather than every run.

create or replace function public.auth_user_by_email(p_email text)
returns table (id uuid, has_password boolean, trial_provisioned boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    u.id,
    coalesce(u.encrypted_password, '') <> '' as has_password,
    coalesce(u.raw_user_meta_data ->> 'provisioned_by', '') = 'trial_pass' as trial_provisioned
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
    and coalesce(btrim(p_email), '') <> ''
  order by u.created_at asc
  limit 1;
$$;

revoke all on function public.auth_user_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_by_email(text) to service_role;

comment on function public.auth_user_by_email(text) is
  'Service-role lookup of an auth user by email for Trial Pass account linking. Returns id, has_password, trial_provisioned.';

alter table public.trial_passes
  add column if not exists account_link_attempted_at timestamptz,
  add column if not exists account_link_error text;

create index if not exists trial_passes_unlinked_idx
  on public.trial_passes (account_link_attempted_at nulls first)
  where user_id is null;
