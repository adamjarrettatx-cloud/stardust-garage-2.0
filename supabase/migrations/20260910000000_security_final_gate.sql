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

begin;

-- ---------------------------------------------------------------------------
-- DB-02: free-account creation/display edits cannot manufacture verification.
-- ---------------------------------------------------------------------------
drop policy if exists free_accounts_self_insert on public.free_accounts;
drop policy if exists free_accounts_self_update on public.free_accounts;
alter table public.free_accounts alter column phone_verified_at drop default;

create or replace function public.create_own_free_account(
  p_full_name text,
  p_phone text,
  p_email text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if exists (select 1 from public.free_accounts where user_id = auth.uid()) then
    raise exception 'free account already exists' using errcode = '23505';
  end if;

  -- Verification is deliberately not caller-controlled. Only the verified
  -- server flow may set a timestamp after Twilio confirms the claimed phone.
  insert into public.free_accounts (user_id, full_name, phone, email, phone_verified_at)
  values (auth.uid(), p_full_name, p_phone, p_email, null);
end;
$$;

create or replace function public.update_own_free_account_display(
  p_full_name text,
  p_email text,
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

  -- Do not add phone, phone_verified_at, role, or entitlement columns here.
  update public.free_accounts
     set full_name = p_full_name,
         email = p_email,
         profile_photo_path = p_profile_photo_path
   where user_id = auth.uid();
end;
$$;

revoke all on function public.create_own_free_account(text, text, text) from public;
revoke all on function public.update_own_free_account_display(text, text, text) from public;
grant execute on function public.create_own_free_account(text, text, text) to authenticated;
grant execute on function public.update_own_free_account_display(text, text, text) to authenticated;

commit;

begin;

-- ---------------------------------------------------------------------------
-- DB-03: unlisted event products and tiers are never anonymously enumerable.
-- ---------------------------------------------------------------------------
drop policy if exists ticket_products_public_read on public.ticket_products;
create policy ticket_products_public_read on public.ticket_products
  for select using (
    is_active = true
    and exists (
      select 1 from public.events e
      where e.id = ticket_products.event_id
        and e.status = 'published'
        and e.ticketing_mode = 'internal'
        and e.visibility = 'public'
    )
  );

drop policy if exists ticket_price_tiers_public_read on public.ticket_price_tiers;
create policy ticket_price_tiers_public_read on public.ticket_price_tiers
  for select using (
    is_active = true
    and exists (
      select 1 from public.ticket_products p
      join public.events e on e.id = p.event_id
      where p.id = ticket_price_tiers.product_id
        and p.is_active = true
        and e.status = 'published'
        and e.ticketing_mode = 'internal'
        and e.visibility = 'public'
    )
  );

commit;
