-- View Portal "Programmer" fixture. ISOLATED PREVIEW DATABASE ONLY.
-- Synthetic Programmer identity, sample calendar dates and sample pitches,
-- relative to today (Austin time). Re-runnable: replaces only its own rows.
do $$
declare
  v_user uuid;
  v_email text := 'view-programmer@preview.sdgatx.invalid';
  v_contact uuid;
  d date := (now() at time zone 'America/Chicago')::date;
  sat date := d + ((6 - extract(dow from d)::int + 7) % 7);  -- next Saturday (or today)
  v_draft uuid;
begin
  if to_regclass('public.view_portal_personas') is null or to_regclass('public.date_pitches') is null then
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
      jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'view_portal_persona','programmer'),
      jsonb_build_object('full_name','Preview programmer'), now(), now(), '', '', '', '', false, false);
    insert into auth.identities (id, user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_user, 'email', v_user::text,
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true), now(), now(), now());
  elsif (select raw_app_meta_data->>'view_portal_persona' from auth.users where id = v_user) is distinct from 'programmer' then
    raise exception 'Existing identity is not the registered programmer persona';
  end if;

  insert into public.free_accounts (user_id, full_name, email, phone, phone_verified_at)
  values (v_user, 'Preview programmer', v_email, '+12025550199', now())
  on conflict (user_id) do update set full_name = excluded.full_name;

  select contact_id into v_contact from public.partner_profiles where user_id = v_user;
  if v_contact is null then
    insert into public.contacts (display_name, email, contact_type, profile_kind)
    values ('Preview programmer', v_email, array['programmer'], 'person') returning id into v_contact;
    insert into public.partner_profiles (user_id, contact_id, full_name, invited_email, is_active, activated_at)
    values (v_user, v_contact, 'Preview programmer', v_email, true, now() - interval '1 day');
  end if;

  insert into public.view_portal_personas (persona_id, user_id, ready, fixture_version)
  values ('programmer', v_user, true, 1)
  on conflict (persona_id) do update set user_id = excluded.user_id, ready = true;

  -- Sample calendar: public Saturdays, plus dates that must read as Unavailable.
  delete from public.date_pitches where contact_id = v_contact;
  delete from public.events where slug like 'preview-programmer-%';
  delete from public.team_events where title like 'PREVIEW ONLY - Programmer %';
  insert into public.events (title, event_date, slug, status, visibility, event_type, is_sdg_only, event_time, event_end_time) values
    ('PREVIEW ONLY - Saturday Session', sat, 'preview-programmer-sat-1', 'published', 'public', 'standard', true, '10:00 PM', '2:00 AM'),
    ('PREVIEW ONLY - Late Night Disco', sat + 7, 'preview-programmer-sat-2', 'published', 'public', 'standard', true, '9:00 PM', '2:00 AM'),
    ('PREVIEW ONLY - House Showcase', sat + 21, 'preview-programmer-sat-4', 'published', 'public', 'standard', true, '10:00 PM', '3:00 AM'),
    ('PREVIEW ONLY - Private rental (hidden)', sat + 6, 'preview-programmer-private', 'published', 'internal', 'standard', true, '7:00 PM', '11:00 PM'),
    ('PREVIEW ONLY - Micro party (hidden)', sat + 13, 'preview-programmer-micro', 'published', 'public', 'micro_party', true, '8:00 PM', '12:00 AM');
  insert into public.events (title, event_date, slug, status, visibility, event_type, is_sdg_only, event_time, event_end_time)
  values ('PREVIEW ONLY - Approved pitch draft', sat + 14, 'preview-programmer-draft', 'draft', 'public', 'standard', true, '10:00 PM', '2:00 AM')
  returning id into v_draft;
  insert into public.team_events (title, event_date) values ('PREVIEW ONLY - Programmer team hold', sat + 20);

  -- Sample pitches: one pending (date stays open), one approved, one declined, one withdrawn.
  insert into public.date_pitches (contact_id, applicant_user_id, full_name, email, pitch_date, title, concept, lineup,
    start_time, end_time, expected_attendance, notes, status, decline_reason, event_id, decided_at, created_at) values
    (v_contact, v_user, 'Preview programmer', v_email, sat + 12, 'Velvet Static: Shoegaze Night', 'A loud, hazy guitar night with visuals.', 'Sample Band A, Sample Band B',
      '21:00', '01:00', '100_250', null, 'pending', null, null, null, now() - interval '2 days'),
    (v_contact, v_user, 'Preview programmer', v_email, sat + 14, 'Deep Cuts Social', 'Record-collector DJ night.', 'Sample DJ',
      '22:00', '02:00', '250_400', null, 'approved', null, v_draft, now() - interval '3 days', now() - interval '6 days'),
    (v_contact, v_user, 'Preview programmer', v_email, sat + 6, 'Sunday Ambient Brunch', 'Daytime ambient set.', null,
      '12:00', '16:00', 'under_100', null, 'declined', 'Date filled', null, now() - interval '4 days', now() - interval '8 days'),
    (v_contact, v_user, 'Preview programmer', v_email, sat + 26, 'Synth Swap Meet', 'Gear swap with live demos.', null,
      '18:00', '22:00', 'under_100', null, 'withdrawn', null, null, now() - interval '1 day', now() - interval '5 days');
end $$;
