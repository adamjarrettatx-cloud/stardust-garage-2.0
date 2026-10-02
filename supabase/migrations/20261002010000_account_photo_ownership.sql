begin;

-- Keep legacy RPC signatures, but never accept a storage pointer from clients.
-- Upload/removal endpoints are the only owners of photo-pointer mutations.
create or replace function public.update_own_free_account_display(
  p_full_name text, p_email text, p_profile_photo_path text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if exists(select 1 from public.free_accounts where user_id=auth.uid()
    and profile_photo_path is distinct from p_profile_photo_path) then
    raise exception 'Use the authenticated photo upload endpoint' using errcode='42501';
  end if;
  update public.free_accounts set full_name=p_full_name,
    email=(select email from auth.users where id=auth.uid())
    where user_id=auth.uid();
end;
$$;

create or replace function public.update_own_member_profile_display(
  p_display_name text, p_phone text, p_notification_preferences jsonb, p_profile_photo_path text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if exists(select 1 from public.member_profiles where user_id=auth.uid()
    and profile_photo_path is distinct from p_profile_photo_path) then
    raise exception 'Use the authenticated photo upload endpoint' using errcode='42501';
  end if;
  update public.member_profiles set full_name=p_display_name,phone=p_phone,
    notification_preferences=p_notification_preferences where user_id=auth.uid();
end;
$$;

revoke all on function public.update_own_free_account_display(text,text,text) from public,anon;
revoke all on function public.update_own_member_profile_display(text,text,jsonb,text) from public,anon;
grant execute on function public.update_own_free_account_display(text,text,text) to authenticated;
grant execute on function public.update_own_member_profile_display(text,text,jsonb,text) to authenticated;
revoke execute on function public.create_own_free_account(text,text,text) from public,anon;

-- Defense against present or future table policies accidentally restoring
-- direct writes. auth.role() reflects the JWT, not SECURITY DEFINER's owner.
create or replace function public.guard_account_photo_pointer()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(auth.role(),'') in ('anon','authenticated') and
     ((TG_OP='INSERT' and new.profile_photo_path is not null) or
      (TG_OP='UPDATE' and new.profile_photo_path is distinct from old.profile_photo_path)) then
    raise exception 'Photo pointer is server managed' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_account_photo_pointer() from public,anon,authenticated;
create trigger free_account_photo_pointer_guard before insert or update on public.free_accounts
  for each row execute function public.guard_account_photo_pointer();
create trigger member_photo_pointer_guard before insert or update on public.member_profiles
  for each row execute function public.guard_account_photo_pointer();
commit;
