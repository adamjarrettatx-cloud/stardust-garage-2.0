-- Retain waiver/audit evidence without retaining a deleted auth identity.
alter table public.waiver_acceptances
  add column if not exists deleted_user_email text;

-- Waiver records are immutable except for the narrowly-scoped anonymization
-- that account deletion must perform before auth.users can be removed.
create or replace function public.waiver_acceptances_no_mutate()
returns trigger
language plpgsql
as $$
begin
  if old.user_id is not null
     and new.user_id is null
     and new.deleted_user_email is not null
     and (to_jsonb(new) - array['user_id', 'deleted_user_email'])
         = (to_jsonb(old) - array['user_id', 'deleted_user_email']) then
    return new;
  end if;
  raise exception 'waiver_acceptances rows are immutable';
end;
$$;

-- Replace the original implicit FK with an explicit SET NULL action. Find the
-- existing constraint by column rather than assuming a generated name.
do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select c.conname
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any(c.conkey)
    where c.conrelid = 'public.waiver_acceptances'::regclass
      and c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass
      and a.attname = 'user_id'
  loop
    execute format('alter table public.waiver_acceptances drop constraint %I', v_constraint);
  end loop;
end;
$$;

alter table public.waiver_acceptances
  add constraint waiver_acceptances_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

-- Broadcasts are an audit ledger; removing an admin must not remove the row
-- or block deletion, so the actor reference is nullable and disconnected.
alter table public.notification_broadcasts
  alter column admin_user_id drop not null;

do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select c.conname
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any(c.conkey)
    where c.conrelid = 'public.notification_broadcasts'::regclass
      and c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass
      and a.attname = 'admin_user_id'
  loop
    execute format('alter table public.notification_broadcasts drop constraint %I', v_constraint);
  end loop;
end;
$$;

alter table public.notification_broadcasts
  add constraint notification_broadcasts_admin_user_id_fkey
  foreign key (admin_user_id) references auth.users(id) on delete set null;
