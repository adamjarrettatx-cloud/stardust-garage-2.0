-- SECURITY: fully retire public access to the legacy member-photos bucket.
-- Objects are private and may be read only by the owner or active team/admin
-- users. New writes are restricted to a tame object name inside the caller's
-- own UUID folder; owner_id is also required so a caller cannot claim another
-- account's object through a crafted path.

begin;

update storage.buckets
  set public = false
  where id = 'member-photos';

-- Remove every older member-photos policy irrespective of its historical name.
do $$
declare policy_name text;
begin
  for policy_name in
    select polname
      from pg_policy
     where polrelid = 'storage.objects'::regclass
       and (
         coalesce(pg_get_expr(polqual, polrelid), '') like '%member-photos%'
         or coalesce(pg_get_expr(polwithcheck, polrelid), '') like '%member-photos%'
       )
  loop
    execute format('drop policy if exists %I on storage.objects', policy_name);
  end loop;
end $$;

create policy member_photos_owner_or_team_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'member-photos'
    and (owner_id = auth.uid()::text or public.is_team())
  );

create policy member_photos_owner_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'member-photos'
    and owner_id = auth.uid()::text
    and name ~ ('^' || auth.uid()::text || '/partner-[A-Za-z0-9][A-Za-z0-9._-]{0,180}$')
  );

create policy member_photos_owner_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'member-photos'
    and owner_id = auth.uid()::text
  )
  with check (
    bucket_id = 'member-photos'
    and owner_id = auth.uid()::text
    and name ~ ('^' || auth.uid()::text || '/partner-[A-Za-z0-9][A-Za-z0-9._-]{0,180}$')
  );

create policy member_photos_owner_delete
  on storage.objects for delete to authenticated
  using (bucket_id = 'member-photos' and owner_id = auth.uid()::text);

commit;
