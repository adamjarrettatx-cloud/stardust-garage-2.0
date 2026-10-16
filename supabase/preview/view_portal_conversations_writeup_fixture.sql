-- View Portal sample inquiry conversation + shared Financial Write-Up.
-- ISOLATED PREVIEW DATABASE ONLY. Re-runnable: replaces only its own rows.
do $$
declare
  v_free uuid; v_admin uuid; v_org_contact uuid;
  v_vi uuid := '0e1f0000-0000-4000-8000-00000000a001';
  v_thread uuid; v_q uuid;
  v_event uuid; v_product uuid; v_order uuid; v_item uuid;
  qty int[] := array[2,1,4,2,1,3,2,1,2,2];
  i int; s int; sub bigint; tax bigint;
begin
  if to_regclass('public.view_portal_personas') is null then
    raise exception 'Refusing: not the isolated View Portal database';
  end if;
  select user_id into v_free from public.view_portal_personas where persona_id = 'free';
  select user_id into v_admin from public.view_portal_personas where persona_id = 'admin';
  select pp.contact_id into v_org_contact from public.partner_profiles pp
    join public.view_portal_personas p on p.user_id = pp.user_id where p.persona_id = 'organizer';

  -- 1. Venue inquiry from the Free account, with a conversation and Team Notes.
  delete from public.submission_threads where submission_type = 'venue-inquiries' and submission_id = v_vi;
  delete from public.submission_notes where submission_type = 'venue-inquiries' and submission_id = v_vi;
  delete from public.venue_inquiries where id = v_vi;
  insert into public.venue_inquiries (id, inquiry_type, full_name, email, phone, website, event_name, event_type,
    preferred_dates, event_duration, expected_attendance, preferred_setup, needs_setup_teardown, event_vision,
    outside_vendors, budget_range, collaboration, how_did_you_hear, status, created_at)
  values (v_vi, 'private', 'Preview Alpha', 'view-free@preview.sdgatx.invalid', '+12025550100', 'https://example.invalid',
    'PREVIEW ONLY - Birthday Warehouse Party', 'Birthday', 'Any Saturday in December', '5 hours', '100-150',
    'Standing room with a DJ booth', 'Yes', 'A disco-themed 30th birthday with a DJ and photo booth.',
    'Photo booth vendor', '$2,000-$4,000', 'No', 'Instagram', 'contacted', now() - interval '5 days');

  insert into public.submission_threads (submission_type, submission_id, subject, invite_email, participant_user_id,
    participant_name, created_by, created_at, invited_at, claimed_at, last_team_message_at, last_guest_message_at,
    team_last_read_at, guest_last_read_at)
  values ('venue-inquiries', v_vi, 'PREVIEW ONLY - Birthday Warehouse Party', 'view-free@preview.sdgatx.invalid', v_free,
    'Preview Alpha', v_admin, now() - interval '4 days', now() - interval '4 days', now() - interval '4 days',
    now() - interval '1 day', now() - interval '3 hours', now() - interval '1 day', now() - interval '20 hours')
  returning id into v_thread;
  insert into public.submission_thread_messages (thread_id, author_kind, author_id, author_name, kind, body, created_at)
  values (v_thread, 'team', v_admin, 'SDG Team', 'message', 'Thanks for reaching out. December 12 and 19 are both open for a private event of that size.', now() - interval '4 days');
  insert into public.submission_thread_messages (thread_id, author_kind, author_id, author_name, kind, body, created_at)
  values (v_thread, 'guest', v_free, 'Preview Alpha', 'message', 'December 12 would be perfect. Can our photo booth vendor load in at 6?', now() - interval '3 days');
  insert into public.submission_thread_messages (thread_id, author_kind, author_id, author_name, kind, body, created_at)
  values (v_thread, 'team', v_admin, 'SDG Team', 'question', 'Roughly how many guests will be 21 or older?', now() - interval '1 day')
  returning id into v_q;
  insert into public.submission_thread_messages (thread_id, author_kind, author_id, author_name, kind, reply_to_id, body, created_at)
  values (v_thread, 'guest', v_free, 'Preview Alpha', 'message', v_q, 'All of them, it is a 21+ party.', now() - interval '3 hours');
  insert into public.submission_notes (submission_type, submission_id, author_id, author_name, author_email, body, created_at)
  values ('venue-inquiries', v_vi, v_admin, 'Preview admin', 'view-admin@preview.sdgatx.invalid',
    'Sample team note: quote the standard Saturday private rate.', now() - interval '2 days');

  -- 2. Past event organized by the Event Organizer test account, with sample
  --    paid orders, a saved Write-Up and a shared organizer snapshot.
  select id into v_event from public.events where slug = 'preview-writeup-night';
  if v_event is not null then
    delete from public.tickets where event_id = v_event;
    delete from public.order_items where order_id in (select id from public.orders where event_id = v_event);
    delete from public.orders where event_id = v_event;
    delete from public.ticket_products where event_id = v_event;
    delete from public.event_writeups where event_id = v_event;
    delete from public.events where id = v_event;
  end if;
  insert into public.events (title, event_date, slug, status, visibility, event_type, is_sdg_only, contact_id,
    ticketing_mode, event_time, event_end_time)
  values ('PREVIEW ONLY - Write-Up Night', date '2026-10-03', 'preview-writeup-night', 'published', 'public', 'standard',
    false, v_org_contact, 'internal', '9:00 PM', '2:00 AM')
  returning id into v_event;
  insert into public.ticket_products (event_id, name, description, min_per_order, max_per_order, is_active)
  values (v_event, 'Preview General Admission', 'Synthetic inventory only.', 1, 4, true) returning id into v_product;

  for i in 1..array_length(qty, 1) loop
    sub := 2500 * qty[i]; tax := round(sub * 0.0825);
    insert into public.orders (event_id, user_id, buyer_email, buyer_name, status, subtotal_cents, total_cents, tax_cents,
      refunded_cents, refunded_tax_cents, currency, checkout_kind, paid_at, raw_metadata, created_at)
    values (v_event, null, 'view-buyer-' || i || '@preview.sdgatx.invalid', 'Preview Buyer ' || i,
      case when i = 5 then 'refunded' else 'paid' end, sub, sub + tax, tax,
      case when i = 5 then sub + tax else 0 end, case when i = 5 then tax else 0 end,
      'usd', 'ticket_order', now() - interval '20 days', jsonb_build_object('view_portal', true), now() - interval '20 days' + make_interval(mins => i))
    returning id into v_order;
    insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_cents, subtotal_cents)
    values (v_order, v_product, 'Preview General Admission', qty[i], 2500, sub) returning id into v_item;
    for s in 0..qty[i] - 1 loop
      insert into public.tickets (order_id, order_item_id, event_id, product_id, seat_index, ticket_code, status)
      values (v_order, v_item, v_event, v_product, s, 'PREVIEW-WU-' || encode(gen_random_bytes(12), 'hex'),
        case when i = 5 then 'refunded' else 'valid' end);
    end loop;
  end loop;

  insert into public.event_writeups (event_id, door_gross_cents, organizer_percent, adjustments, notes, created_by, updated_by,
    organizer_snapshot, shared_at, shared_by)
  values (v_event, 245000, 70,
    '[{"id":"preview-adj-1","label":"Flyer printing reimbursed","amount_cents":6000}]'::jsonb,
    'Preview only. Internal note the organizer never sees.', v_admin, v_admin,
    '{"version": 1, "event": {"title": "PREVIEW ONLY - Write-Up Night", "event_date": "2026-10-03"}, "online": {"tickets_sold": 19, "gross_cents": 54127, "refunds_cents": 2706, "sales_tax_cents": 3921, "fees_cents": 1870, "net_cents": 45630}, "door": {"entered": true, "gross_cents": 245000, "sales_tax_cents": 20213, "sales_tax_bps": 825, "cc_fees_cents": 9433, "cc_fee_bps": 385, "net_cents": 215354}, "net_ticket_revenue_cents": 260984, "organizer_percent": 70, "gross_payout_cents": 182689, "adjustments": [{"label": "Flyer printing reimbursed", "amount_cents": 6000}], "net_payout_cents": 188689}'::jsonb, now() - interval '2 days', v_admin);
end $$;
