-- Availability stations remain separate from team_members and full calendar RLS.
begin;
alter table public.station_accounts drop constraint station_accounts_role_check;
alter table public.station_accounts add constraint station_accounts_role_check
  check (role in ('security','front_desk','calendar_availability'));

create function public.station_calendar_availability(p_hash text)
returns table(date text, available boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare first_day date := (now() at time zone 'America/Chicago')::date;
begin
  if not exists (
    select 1 from public.resolve_station_session(p_hash) s
    where s.role = 'calendar_availability'
  ) then raise exception 'Not authorized' using errcode = '42501'; end if;
  -- Every stored entry blocks its entire calendar date, including internal
  -- drafts/holds, unpublished/unlisted events and team-only entries.
  -- Deliberately return no identifiers, counts, reasons or event metadata.
  return query
    with blocked as (
      select e.event_date from public.events e
        where e.event_date between first_day and first_day + 364
      union
      select t.event_date from public.team_events t
        where t.event_date between first_day and first_day + 364
    )
    select to_char(first_day + n, 'YYYY-MM-DD'),
      not exists (select 1 from blocked b where b.event_date = first_day + n)
    from generate_series(0,364) n order by n;
end;
$$;
revoke all on function public.station_calendar_availability(text) from public, anon, authenticated;
grant execute on function public.station_calendar_availability(text) to service_role;
commit;
