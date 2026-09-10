-- Recurring events are a series of independent event rows. Sales, attendance,
-- and ticket inventory stay on each occurrence; event_series is only the
-- schedule/template and rollup anchor.
create table if not exists public.event_series (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  recurrence_freq text not null check (recurrence_freq in ('weekly', 'biweekly')),
  recurrence_weekday smallint not null check (recurrence_weekday between 0 and 6),
  starts_on date not null,
  ends_on date,
  is_active boolean not null default true,
  template_event_id uuid references public.events(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);

alter table public.events
  add column if not exists series_id uuid references public.event_series(id) on delete set null,
  add column if not exists recurrence_position integer,
  add constraint events_recurrence_position_check
    check (recurrence_position is null or recurrence_position >= 1);

create index if not exists events_series_event_date_idx on public.events(series_id, event_date);
create unique index if not exists events_series_occurrence_date_uidx
  on public.events(series_id, event_date) where series_id is not null;
create unique index if not exists events_series_recurrence_position_uidx
  on public.events(series_id, recurrence_position)
  where series_id is not null and recurrence_position is not null;

create table if not exists public.series_generation_log (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.event_series(id) on delete cascade,
  event_id uuid not null unique references public.events(id) on delete cascade,
  template_event_id uuid references public.events(id) on delete set null,
  previous_event_id uuid references public.events(id) on delete set null,
  generated_for date not null,
  generated_at timestamptz not null default now(),
  unique (series_id, generated_for)
);
create index if not exists series_generation_log_series_generated_idx
  on public.series_generation_log(series_id, generated_at desc);

-- Service-role routes and crons bypass RLS. Authenticated admins retain access
-- for the private admin UI; public reads require a publicly readable occurrence.
alter table public.event_series enable row level security;
alter table public.series_generation_log enable row level security;

drop policy if exists event_series_public_select on public.event_series;
create policy event_series_public_select on public.event_series for select to public
  using (exists (
    select 1 from public.events e
    where e.series_id = event_series.id
      and e.status = 'published'
      and e.visibility = 'public'
  ));
drop policy if exists event_series_team_select on public.event_series;
create policy event_series_team_select on public.event_series for select to authenticated
  using (public.is_team_member());
drop policy if exists event_series_admin_insert on public.event_series;
create policy event_series_admin_insert on public.event_series for insert to authenticated
  with check (public.is_admin());
drop policy if exists event_series_admin_update on public.event_series;
create policy event_series_admin_update on public.event_series for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists event_series_admin_delete on public.event_series;
create policy event_series_admin_delete on public.event_series for delete to authenticated
  using (public.is_admin());

drop policy if exists series_generation_log_admin_select on public.series_generation_log;
create policy series_generation_log_admin_select on public.series_generation_log for select to authenticated
  using (public.is_admin());
drop policy if exists series_generation_log_admin_insert on public.series_generation_log;
create policy series_generation_log_admin_insert on public.series_generation_log for insert to authenticated
  with check (public.is_admin());

drop trigger if exists event_series_set_updated_at on public.event_series;
create trigger event_series_set_updated_at before update on public.event_series
  for each row execute function public.handle_updated_at();
