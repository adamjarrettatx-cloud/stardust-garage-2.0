-- SECURITY FINAL GATE: DB-01 through DB-04.
--
-- This migration intentionally narrows direct authenticated mutations to
-- SECURITY DEFINER RPCs whose UPDATE statements name every permitted column.
-- It must be applied through the normal Supabase migration workflow; do not
-- run it ad hoc against production.

begin;

-- ---------------------------------------------------------------------------
-- DB-01: members must not be able to mutate subscription/entitlement columns.
-- ---------------------------------------------------------------------------
drop policy if exists "Members can update own profile" on public.member_profiles;

create or replace function public.update_own_member_profile_display(
  p_display_name text,
  p_phone text,
  p_notification_preferences jsonb,
  p_profile_photo_path text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Storage object paths are bucket-relative. Never accept an absolute path
  -- or traversal segments from an untrusted client.
  if p_profile_photo_path is not null
     and (p_profile_photo_path like '/%' or position('..' in p_profile_photo_path) > 0) then
    raise exception 'invalid profile photo path' using errcode = '22023';
  end if;

  -- Keep this column list deliberately exhaustive and small. In particular,
  -- no membership, Stripe, token, or entitlement column may be added here.
  update public.member_profiles
     set full_name = p_display_name,
         phone = p_phone,
         notification_preferences = p_notification_preferences,
         profile_photo_path = p_profile_photo_path
   where user_id = auth.uid();
end;
$$;

revoke all on function public.update_own_member_profile_display(text, text, jsonb, text) from public;
grant execute on function public.update_own_member_profile_display(text, text, jsonb, text) to authenticated;

commit;
