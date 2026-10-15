-- Programmer profile: public-safe venue calendar and date pitches.
--
-- A Programmer is a contact type whose portal shows the next 12 months as
-- open / public event / unavailable, and lets them pitch an event for an open
-- date. Pitching never holds a date. An admin approves a pitch, which creates
-- a Draft event on that date with the Programmer as organizer; it still needs
-- Go Live before it appears publicly.
--
-- Privacy rule: the calendar RPC returns titles and times only for events that
-- are already public (published, public visibility, not a micro party). Every
-- other occupied date — drafts, internal/unlisted events, micro parties,
-- private rentals and internal team calendar holds — comes back as
-- 'unavailable' with no detail.

-- 1. Contact type -----------------------------------------------------------
alter table public.contacts drop constraint if exists contacts_contact_type_check;
alter table public.contacts add constraint contacts_contact_type_check check (
  contact_type <@ array['dj','artist','performer','collective','promoter','venue_renter','vendor',
    'resident','event_organizer','other','organization','person','programmer']::text[]
);

-- 2. Pitches ----------------------------------------------------------------
create table if not exists public.date_pitches (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  -- The submitting account. Lets a team conversation attach to the
  -- Programmer's account immediately, as membership applications do.
  applicant_user_id uuid references auth.users(id) on delete set null,
  full_name text,
  email text,
  pitch_date date not null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  concept text not null check (char_length(btrim(concept)) between 1 and 4000),
  lineup text check (lineup is null or char_length(lineup) <= 2000),
  start_time text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time text not null check (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  expected_attendance text not null check (expected_attendance in ('under_100','100_250','250_400','400_plus')),
  notes text check (notes is null or char_length(notes) <= 2000),
  status text not null default 'pending' check (status in ('pending','approved','declined','withdrawn')),
  decline_reason text check (decline_reason is null or char_length(decline_reason) <= 1000),
  event_id uuid references public.events(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists date_pitches_one_pending_per_date
  on public.date_pitches (contact_id, pitch_date) where status = 'pending';
create index if not exists date_pitches_status_date on public.date_pitches (status, pitch_date);
create index if not exists date_pitches_contact on public.date_pitches (contact_id, created_at desc);

alter table public.date_pitches enable row level security;
-- Admins read directly (Incoming list, counts, conversations, notes). All
-- writes go through the security-definer functions below. Programmers read
-- their own rows through partner_my_pitches().
drop policy if exists date_pitches_admin_select on public.date_pitches;
create policy date_pitches_admin_select on public.date_pitches
  for select to authenticated using (public.is_admin());
revoke all on public.date_pitches from anon;
revoke insert, update, delete on public.date_pitches from authenticated;
grant select on public.date_pitches to authenticated;

-- 3. Conversations and team notes accept the new submission type ------------
alter table public.submission_threads drop constraint if exists submission_threads_submission_type_check;
alter table public.submission_threads add constraint submission_threads_submission_type_check
  check (submission_type in ('applications','collaborations','micro-parties','venue-inquiries','date-pitches'));
alter table public.submission_notes drop constraint if exists submission_notes_submission_type_check;
alter table public.submission_notes add constraint submission_notes_submission_type_check
  check (submission_type in ('applications','collaborations','micro-parties','venue-inquiries','date-pitches'));

-- 4. Capabilities -----------------------------------------------------------
create or replace function public.partner_has_capability(p_capability text)
returns boolean language sql stable security definer set search_path to '' as $$
  select case
    when p_capability = 'events' then exists(select 1 from public.partner_event_contact_ids())
    else coalesce((
      select case p_capability
        when 'guestList' then c.contact_type && array['dj','artist','performer','resident','organization','event_organizer','collective','promoter']
        when 'pay' then c.contact_type && array['dj','artist','performer','resident']
        when 'contracts' then c.contact_type && array['dj','artist','performer','resident','organization','event_organizer','collective','venue_renter','vendor']
        when 'calendar' then c.contact_type && array['programmer']
        when 'pitches' then c.contact_type && array['programmer']
        else false end
      from public.contacts c where c.id = public.partner_contact_id()
        and not exists(select 1 from public.team_members t where t.user_id=auth.uid() and t.role in ('front_desk','calendar_viewer'))
    ), false)
  end;
$$;

-- 5. Helpers ----------------------------------------------------------------
create or replace function public.austin_today()
returns date language sql stable set search_path to '' as $$
  select (now() at time zone 'America/Chicago')::date
$$;

-- Same "is this a public listing" rule as lib/event-visibility.js.
create or replace function public.date_has_public_event(p_date date)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists(select 1 from public.events e where e.event_date = p_date
    and e.status = 'published' and e.visibility = 'public' and coalesce(e.event_type,'standard') <> 'micro_party')
$$;

create or replace function public.date_is_open(p_date date)
returns boolean language sql stable security definer set search_path to '' as $$
  select not exists(select 1 from public.events e where e.event_date = p_date)
     and not exists(select 1 from public.team_events t where t.event_date = p_date)
$$;
revoke all on function public.date_has_public_event(date) from public, anon, authenticated;
revoke all on function public.date_is_open(date) from public, anon, authenticated;

create or replace function public.pitch_time_label(p text)
returns text language sql immutable set search_path to '' as $$
  select case when p is null then null
    else to_char(('2000-01-01 ' || p)::timestamp, 'FMHH12:MI AM') end
$$;

-- 6. Programmer calendar ----------------------------------------------------
-- One row per day for the next 365 days (Austin). Public days carry the
-- public listing fields; every other occupied day carries nothing.
create or replace function public.partner_programming_calendar()
returns table(day date, state text, title text, event_time text, event_end_time text, slug text)
language plpgsql stable security definer set search_path to '' as $$
declare v_start date := public.austin_today();
begin
  if not public.partner_has_capability('calendar') then
    raise exception 'Not available for this profile' using errcode = '42501';
  end if;
  return query
  with days as (
    select d::date as day from generate_series(v_start, v_start + 364, interval '1 day') d
  ), pub as (
    select distinct on (e.event_date) e.event_date, e.title, e.event_time, e.event_end_time, e.slug
    from public.events e
    where e.event_date between v_start and v_start + 364
      and e.status = 'published' and e.visibility = 'public' and coalesce(e.event_type,'standard') <> 'micro_party'
    order by e.event_date, e.event_time nulls last, e.created_at
  ), busy as (
    select event_date from public.events where event_date between v_start and v_start + 364
    union select event_date from public.team_events where event_date between v_start and v_start + 364
  )
  select days.day,
    case when pub.event_date is not null then 'public'
         when busy.event_date is not null then 'unavailable'
         else 'open' end,
    pub.title, pub.event_time, pub.event_end_time, pub.slug
  from days
  left join pub on pub.event_date = days.day
  left join (select distinct event_date from busy) busy on busy.event_date = days.day
  order by days.day;
end;
$$;

create or replace function public.partner_my_pitches()
returns table(id uuid, pitch_date date, title text, concept text, lineup text, start_time text, end_time text,
  expected_attendance text, notes text, status text, decline_reason text, event_id uuid, decided_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path to '' as $$
begin
  if not public.partner_has_capability('pitches') then
    raise exception 'Not available for this profile' using errcode = '42501';
  end if;
  return query select p.id, p.pitch_date, p.title, p.concept, p.lineup, p.start_time, p.end_time,
    p.expected_attendance, p.notes, p.status, p.decline_reason, p.event_id, p.decided_at, p.created_at
  from public.date_pitches p where p.contact_id = public.partner_contact_id()
  order by p.created_at desc;
end;
$$;

create or replace function public.partner_submit_pitch(
  p_date date, p_title text, p_concept text, p_lineup text, p_start_time text, p_end_time text,
  p_expected_attendance text, p_notes text
) returns uuid language plpgsql volatile security definer set search_path to '' as $$
declare
  v_contact uuid := public.partner_contact_id();
  v_today date := public.austin_today();
  v_id uuid;
  v_name text;
  v_email text;
begin
  if v_contact is null or not public.partner_has_capability('pitches') then
    raise exception 'Not available for this profile' using errcode = '42501';
  end if;
  if p_date is null or p_date < v_today or p_date > v_today + 364 then
    raise exception 'Pick a date within the next 12 months.' using errcode = '22023';
  end if;
  if not public.date_is_open(p_date) then
    raise exception 'That date is no longer open.' using errcode = '22023';
  end if;
  if (select count(*) from public.date_pitches where contact_id = v_contact and status = 'pending') >= 20 then
    raise exception 'You have 20 pitches waiting for review. Withdraw one or wait for a decision.' using errcode = '22023';
  end if;
  if exists(select 1 from public.date_pitches where contact_id = v_contact and pitch_date = p_date and status = 'pending') then
    raise exception 'You already have a pitch waiting for this date.' using errcode = '23505';
  end if;
  select coalesce(nullif(btrim(pp.full_name),''), c.primary_contact_name, c.display_name), lower(u.email)
    into v_name, v_email
  from public.contacts c
  left join public.partner_profiles pp on pp.user_id = auth.uid() and pp.contact_id = c.id
  left join auth.users u on u.id = auth.uid()
  where c.id = v_contact;

  insert into public.date_pitches(contact_id, applicant_user_id, full_name, email, pitch_date, title, concept,
    lineup, start_time, end_time, expected_attendance, notes)
  values (v_contact, auth.uid(), v_name, v_email, p_date, btrim(p_title), btrim(p_concept),
    nullif(btrim(coalesce(p_lineup,'')),''), p_start_time, p_end_time, p_expected_attendance,
    nullif(btrim(coalesce(p_notes,'')),''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.partner_withdraw_pitch(p_id uuid)
returns boolean language plpgsql volatile security definer set search_path to '' as $$
begin
  if not public.partner_has_capability('pitches') then
    raise exception 'Not available for this profile' using errcode = '42501';
  end if;
  update public.date_pitches set status = 'withdrawn', updated_at = now()
  where id = p_id and contact_id = public.partner_contact_id() and status = 'pending';
  return found;
end;
$$;

-- 7. Admin decisions --------------------------------------------------------
create or replace function public.approve_date_pitch(p_id uuid)
returns uuid language plpgsql volatile security definer set search_path to '' as $$
declare
  v public.date_pitches%rowtype;
  v_event uuid;
  v_base text;
  v_slug text;
  v_n int := 1;
  v_desc text;
begin
  if not public.is_admin() then
    raise exception 'Administrators only' using errcode = '42501';
  end if;
  select * into v from public.date_pitches where id = p_id for update;
  if not found then raise exception 'Pitch not found' using errcode = 'P0002'; end if;
  if v.status <> 'pending' then raise exception 'This pitch has already been decided.' using errcode = '22023'; end if;

  v_base := trim(both '-' from regexp_replace(lower(v.title), '[^a-z0-9]+', '-', 'g'));
  if v_base = '' then v_base := 'event'; end if;
  v_base := left(v_base, 60) || '-' || to_char(v.pitch_date, 'YYYY-MM-DD');
  v_slug := v_base;
  while exists(select 1 from public.events where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  v_desc := v.concept
    || case when v.lineup is not null then E'\n\nLineup: ' || v.lineup else '' end;

  insert into public.events(title, event_date, event_time, event_end_time, description, slug,
    status, visibility, event_type, contact_id, is_sdg_only)
  values (v.title, v.pitch_date, public.pitch_time_label(v.start_time), public.pitch_time_label(v.end_time),
    v_desc, v_slug, 'draft', 'public', 'standard', v.contact_id, false)
  returning id into v_event;

  -- Organizer tag, as EventForm does when a contact is attached to an event.
  update public.contacts set contact_type = array_append(contact_type, 'event_organizer'), updated_at = now()
  where id = v.contact_id and not (contact_type @> array['event_organizer']);

  update public.date_pitches set status = 'approved', event_id = v_event,
    decided_by = auth.uid(), decided_at = now(), updated_at = now()
  where id = p_id;

  update public.date_pitches set status = 'declined', decline_reason = 'Date filled',
    decided_by = auth.uid(), decided_at = now(), updated_at = now()
  where pitch_date = v.pitch_date and status = 'pending' and id <> p_id;

  return v_event;
end;
$$;

create or replace function public.decline_date_pitch(p_id uuid, p_reason text)
returns boolean language plpgsql volatile security definer set search_path to '' as $$
begin
  if not public.is_admin() then
    raise exception 'Administrators only' using errcode = '42501';
  end if;
  update public.date_pitches set status = 'declined',
    decline_reason = nullif(btrim(coalesce(p_reason,'')),''),
    decided_by = auth.uid(), decided_at = now(), updated_at = now()
  where id = p_id and status = 'pending';
  return found;
end;
$$;

revoke all on function public.partner_programming_calendar() from public, anon;
revoke all on function public.partner_my_pitches() from public, anon;
revoke all on function public.partner_submit_pitch(date,text,text,text,text,text,text,text) from public, anon;
revoke all on function public.partner_withdraw_pitch(uuid) from public, anon;
revoke all on function public.approve_date_pitch(uuid) from public, anon;
revoke all on function public.decline_date_pitch(uuid,text) from public, anon;
grant execute on function public.partner_programming_calendar() to authenticated;
grant execute on function public.partner_my_pitches() to authenticated;
grant execute on function public.partner_submit_pitch(date,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.partner_withdraw_pitch(uuid) to authenticated;
grant execute on function public.approve_date_pitch(uuid) to authenticated;
grant execute on function public.decline_date_pitch(uuid,text) to authenticated;
