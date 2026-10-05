-- The shared Front Desk station stays signed in on the venue laptop until
-- someone signs it out, the password changes, the account is disabled, or the
-- owner revokes it from Manage stations (all of which bump the epoch or set
-- revoked_at). Security and Calendar Availability keep 12-hour sessions.
begin;
alter table public.station_sessions drop constraint station_sessions_check;
alter table public.station_sessions add constraint station_sessions_check
  check (expires_at <= created_at + interval '100 years');

create or replace function public.open_station_session(p_station uuid,p_epoch integer,p_hash text)
returns boolean language plpgsql security invoker set search_path=public as $$
declare a public.station_accounts;
begin
  select * into a from public.station_accounts where id=p_station for update;
  if not found or not a.active or a.epoch<>p_epoch or a.reset_started_at is not null then return false; end if;
  insert into public.station_sessions(token_hash,station_id,epoch,expires_at)
    values(p_hash,a.id,a.epoch,
      now()+case when a.role='front_desk' then interval '100 years' else interval '12 hours' end);
  insert into public.station_access_events(station_id,actor_id,action) values(a.id,a.user_id,'login');
  delete from public.station_sessions where expires_at < now()-interval '7 days';
  return true;
end $$;
commit;
