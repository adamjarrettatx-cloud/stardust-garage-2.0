-- View Portal "Employee" fixture. ISOLATED PREVIEW DATABASE ONLY.
-- Synthetic identity + sample schedule/hours relative to today (Austin time).
-- Re-runnable: replaces this fixture's own rows; touches nothing else.
do $$
declare
  v_user uuid;
  v_email text := 'view-employee@preview.sdgatx.invalid';
  v_worker uuid;
  v_kai uuid;
  v_sam uuid;
  d date := (now() at time zone 'America/Chicago')::date;
  wk date := d - ((extract(isodow from d)::int) - 1);   -- this Monday
  t timestamptz;
  s record;
  sh uuid;
begin
  if to_regclass('public.view_portal_personas') is null then
    raise exception 'Refusing: not the isolated View Portal database';
  end if;

  select id into v_user from auth.users where email = v_email;
  if v_user is null then
    v_user := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user, is_anonymous)
    values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email,
      crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf')), now(),
      jsonb_build_object('provider','email','providers',jsonb_build_array('email'),
        'view_portal_persona','employee','employee_account',true),
      jsonb_build_object('full_name','Preview employee'), now(), now(), '', '', '', '', false, false);
    insert into auth.identities (id, user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_user, 'email', v_user::text,
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true), now(), now(), now());
  elsif (select raw_app_meta_data->>'view_portal_persona' from auth.users where id = v_user) is distinct from 'employee' then
    raise exception 'Existing identity is not the registered employee persona';
  end if;

  insert into public.view_portal_personas (persona_id, user_id, ready, fixture_version)
  values ('employee', v_user, true, 1)
  on conflict (persona_id) do update set user_id = excluded.user_id, ready = true;

  -- Fixture staff profiles (the persona plus two sample coworkers, no logins).
  select id into v_worker from public.tc_workers where user_id = v_user;
  if v_worker is null then
    insert into public.tc_workers (name, category, active, pay_basis, pin_lookup, pin_verifier, user_id, username, login_enabled, login_managed)
    values ('Avery Preview', 'employee', true, 'hourly', encode(gen_random_bytes(32), 'hex'), 'fixture-no-pin', v_user, 'avery.preview', true, true)
    returning id into v_worker;
  end if;
  select id into v_kai from public.tc_workers where name = 'Kai Sample' and user_id is null;
  if v_kai is null then
    insert into public.tc_workers (name, category, active, pay_basis, pin_lookup, pin_verifier)
    values ('Kai Sample', 'employee', true, 'hourly', encode(gen_random_bytes(32), 'hex'), 'fixture-no-pin') returning id into v_kai;
  end if;
  select id into v_sam from public.tc_workers where name = 'Sam Sample' and user_id is null;
  if v_sam is null then
    insert into public.tc_workers (name, category, active, pay_basis, pin_lookup, pin_verifier)
    values ('Sam Sample', 'employee', true, 'hourly', encode(gen_random_bytes(32), 'hex'), 'fixture-no-pin') returning id into v_sam;
  end if;

  delete from public.tc_change_requests where worker_id in (v_worker, v_kai, v_sam);
  delete from public.tc_shifts where worker_id in (v_worker, v_kai, v_sam);
  delete from public.tc_schedule where worker_id in (v_worker, v_kai, v_sam);
  delete from public.tc_assignments where worker_id in (v_worker, v_kai, v_sam);
  insert into public.tc_assignments (worker_id, role_id, rate_cents) values
    (v_worker, 'bartender', 2200), (v_worker, 'front_door', 2000),
    (v_kai, 'floor_support', 1800), (v_sam, 'front_door', 2000);

  -- Schedule: Thu/Fri/Sat this week and next, 8 PM - 2 AM Austin; coworkers overlap.
  for s in select x.day, x.role, x.who from (values
      (wk + 3, 'bartender', 'me'), (wk + 4, 'bartender', 'me'), (wk + 5, 'front_door', 'me'),
      (wk + 10, 'bartender', 'me'), (wk + 11, 'bartender', 'me'), (wk + 12, 'front_door', 'me'),
      (wk + 4, 'floor_support', 'kai'), (wk + 5, 'front_door', 'sam'), (wk + 11, 'floor_support', 'kai')
    ) as x(day, role, who) loop
    t := (s.day::timestamp + time '20:00') at time zone 'America/Chicago';
    insert into public.tc_schedule (worker_id, role_id, starts_at, ends_at, note)
    values (case s.who when 'me' then v_worker when 'kai' then v_kai else v_sam end, s.role, t, t + interval '6 hours',
      case when s.day = wk + 4 and s.who = 'me' then 'Doors 9pm' else '' end);
  end loop;

  -- Worked hours: last week Thu/Fri/Sat (approved) and this week's past days (pending).
  for s in select x.day, x.mins_late, x.len, x.st from (values
      (wk - 4, 0, 360, 'approved'), (wk - 3, 10, 370, 'approved'), (wk - 2, -5, 345, 'approved')
    ) as x(day, mins_late, len, st) loop
    t := (s.day::timestamp + time '20:00') at time zone 'America/Chicago' + make_interval(mins => s.mins_late);
    insert into public.tc_shifts (worker_id, started_at, ended_at, pay_basis, status)
    values (v_worker, t, t + make_interval(mins => s.len), 'hourly', s.st) returning id into sh;
    insert into public.tc_segments (shift_id, role_id, role_name, rate_cents, started_at, ended_at)
    values (sh, 'bartender', 'Bartender', 2200, t, t + make_interval(mins => s.len));
  end loop;
  -- One recent shift waiting for review, with a pending "fix my hours" request.
  t := ((d - 1)::timestamp + time '20:15') at time zone 'America/Chicago';
  insert into public.tc_shifts (worker_id, started_at, ended_at, pay_basis, status)
  values (v_worker, t, t + interval '5 hours 45 minutes', 'hourly', 'pending') returning id into sh;
  insert into public.tc_segments (shift_id, role_id, role_name, rate_cents, started_at, ended_at)
  values (sh, 'bartender', 'Bartender', 2200, t, t + interval '5 hours 45 minutes');
  insert into public.tc_change_requests (worker_id, kind, shift_id, original_start, original_end, requested_start, requested_end, reason, status)
  values (v_worker, 'edit_shift', sh, t, t + interval '5 hours 45 minutes', t - interval '15 minutes', t + interval '5 hours 45 minutes',
    'The iPad was offline when I arrived at 8.', 'pending');
  -- An approved day off two weeks out.
  t := ((wk + 15)::timestamp) at time zone 'America/Chicago';
  insert into public.tc_change_requests (worker_id, kind, requested_start, requested_end, reason, status, applied_start, applied_end, decided_at)
  values (v_worker, 'time_off', t, t + interval '1 day', 'Family visit', 'approved', t, t + interval '1 day', now());
end $$;
