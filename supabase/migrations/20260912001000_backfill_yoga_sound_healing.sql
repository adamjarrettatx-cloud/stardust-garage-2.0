-- Split the Sep 9, 2026 Yoga + Sound Healing occurrence from the row that was
-- moved to Sep 16. Run after 20260912000000_event_series.sql.
--
-- Manual verification after deploy:
-- select event_date, recurrence_position from events where series_id =
--   (select id from event_series where slug = 'wednesday-yoga-sound-healing') order by event_date;
-- select event_id, count(*) from tickets where event_id in ('c5d89d5f-1b4e-4d61-894a-b21e7cba5f37',
--   (select id from events where slug = 'yoga-sound-healing-at-stardust-garage-2026-09-09')) group by event_id;

do $$
declare
  v_old_id constant uuid := 'c5d89d5f-1b4e-4d61-894a-b21e7cba5f37';
  v_new_id uuid;
  v_series_id uuid;
begin
  -- The date predicate is the re-run guard: once the source is no longer the
  -- Sep 16 row, this migration deliberately does nothing.
  if not exists (
    select 1 from public.events
    where id = v_old_id and event_date = '2026-09-16'
  ) then
    return;
  end if;

  insert into public.events (
    title, event_date, event_time, description, image_url, slug, created_at, updated_at, ticket_url,
    category, tt_event_series_id, discount_codes_generated,
    member_discount_percent, status, event_end_time, visibility, event_type,
    contact_id, is_sdg_only, ticketing_mode, booking_fee_cents_default,
    member_discount_percent_cowork, member_discount_percent_iykyk,
    required_membership_tier, is_weekend_music_experience, tt_last_published_at,
    share_token, member_discount_percent_weekender, member_discount_percent_trial
  )
  select
    title, '2026-09-09', event_time, description, image_url,
    'yoga-sound-healing-at-stardust-garage-2026-09-09', created_at, updated_at, ticket_url,
    category, tt_event_series_id, discount_codes_generated,
    member_discount_percent, status, event_end_time, visibility, event_type,
    contact_id, is_sdg_only, ticketing_mode, booking_fee_cents_default,
    member_discount_percent_cowork, member_discount_percent_iykyk,
    required_membership_tier, is_weekend_music_experience, tt_last_published_at,
    translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_'),
    member_discount_percent_weekender, member_discount_percent_trial
  from public.events
  where id = v_old_id and event_date = '2026-09-16'
  returning id into v_new_id;

  -- Every direct FK into events is reassigned so sales, check-ins, audit trail,
  -- and related administrative records remain with the occurrence that happened.
  update public.artist_pay_requests set event_id = v_new_id where event_id = v_old_id;
  update public.document_contracts set event_id = v_new_id where event_id = v_old_id;
  update public.documents set event_id = v_new_id where event_id = v_old_id;
  update public.door_sessions set event_id = v_new_id where event_id = v_old_id;
  update public.event_bookings set event_id = v_new_id where event_id = v_old_id;
  update public.event_guestlist_grants set event_id = v_new_id where event_id = v_old_id;
  update public.event_ticket_metrics set event_id = v_new_id where event_id = v_old_id;
  update public.financial_transactions set linked_event_id = v_new_id where linked_event_id = v_old_id;
  update public.guest_profiles set first_seen_event_id = v_new_id where first_seen_event_id = v_old_id;
  update public.manual_income_entries set local_event_id = v_new_id where local_event_id = v_old_id;
  update public.member_discount_codes set event_id = v_new_id where event_id = v_old_id;
  update public.member_id_scans set event_id = v_new_id where event_id = v_old_id;
  update public.member_tickets set local_event_id = v_new_id where local_event_id = v_old_id;
  update public.orders set event_id = v_new_id where event_id = v_old_id;
  update public.team_events set linked_event_id = v_new_id where linked_event_id = v_old_id;
  update public.ticket_audit_log set event_id = v_new_id where event_id = v_old_id;
  update public.ticket_checkins set event_id = v_new_id where event_id = v_old_id;
  update public.ticket_discount_codes set event_id = v_new_id where event_id = v_old_id;
  update public.ticket_holds set event_id = v_new_id where event_id = v_old_id;
  update public.ticket_order_attribution set local_event_id = v_new_id where local_event_id = v_old_id;
  update public.ticket_products set event_id = v_new_id where event_id = v_old_id;
  update public.tickets set event_id = v_new_id where event_id = v_old_id;
  update public.trial_pass_checkins set event_id = v_new_id where event_id = v_old_id;
  update public.tt_discovered_events set local_event_id = v_new_id where local_event_id = v_old_id;
  update public.waiver_acceptances set event_id = v_new_id where event_id = v_old_id;

  insert into public.event_series (
    title, slug, recurrence_freq, recurrence_weekday, starts_on, template_event_id
  ) values (
    'Wednesday :: Yoga + Sound Healing', 'wednesday-yoga-sound-healing',
    'weekly', 3, '2026-09-09', v_new_id
  ) returning id into v_series_id;

  update public.events set series_id = v_series_id, recurrence_position = 1 where id = v_new_id;
  update public.events set series_id = v_series_id, recurrence_position = 2 where id = v_old_id;
end $$;
