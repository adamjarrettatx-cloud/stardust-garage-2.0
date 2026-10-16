begin;
-- Organizer attendee list now includes the purchaser's email address.
-- Adam approved email disclosure to organizers on 2026-10-13. Every ticket row
-- carries the email of the order's purchaser (order buyer_email, falling back
-- to the purchaser's member profile email). Phone numbers, ticket codes, order
-- IDs, payment IDs and check-in state remain excluded. Access is unchanged:
-- partner_has_event() still gates every call.
create or replace function public.partner_event_attendees(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare rows jsonb;
begin
  if not public.partner_has_event(p_event_id) then
    raise exception 'Event not found.' using errcode='P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', x.name,
    'purchased_by', case when x.attendee_name is not null and x.buyer_name is not null
      and lower(x.attendee_name) <> lower(x.buyer_name) then x.buyer_name end,
    'purchaser_email', x.purchaser_email,
    'ticket_type', x.ticket_type,
    'purchased_at', x.purchased_at
  ) order by x.purchased_at desc, x.order_rank, x.seat_index), '[]'::jsonb) into rows
  from (
    select
      coalesce(x0.attendee_name, x0.buyer_name, 'Name not provided') name,
      x0.attendee_name, x0.buyer_name, x0.purchaser_email, x0.ticket_type, x0.purchased_at, x0.order_rank, x0.seat_index
    from (
      select
        nullif(btrim(a.full_name), '') attendee_name,
        coalesce(nullif(btrim(o.buyer_name), ''),
          (select nullif(btrim(m.full_name), '') from public.member_profiles m
             where m.id = o.member_profile_id or (o.user_id is not null and m.user_id = o.user_id)
             order by (m.id = o.member_profile_id) desc limit 1)) buyer_name,
        coalesce(nullif(btrim(o.buyer_email), ''),
          (select nullif(btrim(m.email), '') from public.member_profiles m
             where m.id = o.member_profile_id or (o.user_id is not null and m.user_id = o.user_id)
             order by (m.id = o.member_profile_id) desc limit 1)) purchaser_email,
        coalesce(nullif(btrim(i.tier_name_snapshot), ''), nullif(btrim(i.product_name_snapshot), ''), 'Ticket') ticket_type,
        coalesce(o.paid_at, o.created_at) purchased_at,
        o.id::text order_rank,
        t.seat_index
      from public.tickets t
      join public.orders o on o.id = t.order_id and o.event_id = p_event_id
      left join public.order_items i on i.id = t.order_item_id
      left join public.attendees a on a.id = t.attendee_id or (t.attendee_id is null and a.ticket_id = t.id)
      where t.event_id = p_event_id
        and t.status in ('valid', 'used')
        and o.status in ('paid', 'partial_refund')
      limit 5000
    ) x0
  ) x;
  return jsonb_build_object('attendees', rows, 'as_of', now());
end $$;
revoke all on function public.partner_event_attendees(uuid) from public, anon;
grant execute on function public.partner_event_attendees(uuid) to authenticated;
commit;
