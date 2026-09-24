begin;
-- Capability checks are based on the authenticated partner's stored contact
-- tags, never on a persona ID, client-supplied role or main-contact link.
create or replace function public.partner_has_capability(p_capability text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case p_capability
      when 'guestList' then c.contact_type && array['dj','artist','performer','resident','organization','event_organizer','collective','promoter']
      when 'pay' then c.contact_type && array['dj','artist','performer','resident']
      when 'contracts' then c.contact_type && array['dj','artist','performer','resident','organization','event_organizer','collective','venue_renter','vendor']
      when 'events' then c.contact_type && array['organization','event_organizer','collective']
      else false end
    from public.contacts c where c.id = public.partner_contact_id()
      and not exists(select 1 from public.team_members t where t.user_id=auth.uid() and t.role in ('front_desk','calendar_viewer'))
  ),false);
$$;
revoke all on function public.partner_has_capability(text) from public, anon;
grant execute on function public.partner_has_capability(text) to authenticated;

-- Keep the existing return signatures, grants, calculations and dependencies.
-- Fail the whole migration if a deployed body no longer has its reviewed gate.
do $$
declare r record; definition text; needle text; replacement text;
begin
  for r in select * from (values
    ('partner_bookings','b','pay'),
    ('partner_contracts','c','contracts'),
    ('partner_grants','g','guestList')
  ) as gates(name,alias,capability) loop
    definition := pg_get_functiondef(('public.'||r.name||'()')::regprocedure);
    if position('public.partner_has_capability(' in definition) = 0 then
      needle := r.alias||'.contact_id = public.partner_contact_id()';
      if position(needle in definition) = 0 then raise exception 'Unrecognized ownership gate in %',r.name; end if;
      replacement := needle||' and public.partner_has_capability('||quote_literal(r.capability)||')';
      execute replace(definition,needle,replacement);
    end if;
  end loop;
end $$;

create or replace function public.partner_owns_grant(p_grant_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.partner_has_capability('guestList') and exists(
    select 1 from public.event_guestlist_grants g
    where g.id=p_grant_id and g.contact_id=public.partner_contact_id()
  );
$$;
revoke all on function public.partner_owns_grant(uuid) from public,anon;
grant execute on function public.partner_owns_grant(uuid) to authenticated;

-- Restrictive policies prevent the old row-ownership policies bypassing the
-- new capability rule. Existing staff policies still determine staff access.
drop policy if exists profile_pay_capability on public.event_bookings;
create policy profile_pay_capability on public.event_bookings as restrictive for select to authenticated
  using(public.is_team() or public.partner_has_capability('pay'));
drop policy if exists profile_pay_capability on public.artist_pay_requests;
create policy profile_pay_capability on public.artist_pay_requests as restrictive for select to authenticated
  using(public.is_team() or public.partner_has_capability('pay'));
drop policy if exists profile_guest_capability on public.event_guestlist_grants;
create policy profile_guest_capability on public.event_guestlist_grants as restrictive for select to authenticated
  using(public.is_team() or public.partner_has_capability('guestList'));
drop policy if exists profile_contract_capability on public.contract_notifications;
create policy profile_contract_capability on public.contract_notifications as restrictive for all to authenticated
  using(public.is_admin() or public.partner_has_capability('contracts'))
  with check(public.is_admin() or public.partner_has_capability('contracts'));

create or replace function public.member_can_book_studio()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.member_profiles m where m.user_id=auth.uid()
    and m.is_active and m.subscription_status in ('active','trialing') and m.subscription_plan='iykyk');
$$;
revoke all on function public.member_can_book_studio() from public,anon;
grant execute on function public.member_can_book_studio() to authenticated;
drop policy if exists profile_studio_capability on public.studio_bookings;
create policy profile_studio_capability on public.studio_bookings as restrictive for all to authenticated
  using(public.is_admin() or public.member_can_book_studio())
  with check(public.is_admin() or public.member_can_book_studio());

-- Assignments already exist in the event organizer field, guest allocations,
-- event bookings and event-linked contracts. No user-supplied contact ID and
-- no inference from organization_main_contacts is permitted.
create or replace function public.partner_has_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.partner_has_capability('events') and exists(
    select 1 from public.events e where e.id=p_event_id and (
      e.contact_id=public.partner_contact_id()
      or exists(select 1 from public.event_guestlist_grants g where g.event_id=e.id and g.contact_id=public.partner_contact_id())
      or exists(select 1 from public.event_bookings b where b.event_id=e.id and b.contact_id=public.partner_contact_id() and b.status<>'cancelled')
      or exists(select 1 from public.document_contracts c where c.event_id=e.id
        and c.status not in ('draft','voided','cancelled')
        and (c.contact_id=public.partner_contact_id() or c.collective_contact_id=public.partner_contact_id()))
    )
  );
$$;
revoke all on function public.partner_has_event(uuid) from public,anon;
grant execute on function public.partner_has_event(uuid) to authenticated;

create or replace function public.partner_my_events()
returns table(id uuid,title text,event_date date,event_time text,image_url text,status text,ticketing_mode text)
language sql stable security definer set search_path = '' as $$
  select e.id,e.title,e.event_date,e.event_time,e.image_url,e.status,e.ticketing_mode
  from public.events e where public.partner_has_event(e.id)
  order by (e.event_date >= (now() at time zone 'America/Chicago')::date) desc,
    case when e.event_date >= (now() at time zone 'America/Chicago')::date then e.event_date end asc,
    e.event_date desc,e.id;
$$;
revoke all on function public.partner_my_events() from public,anon;
grant execute on function public.partner_my_events() to authenticated;

create or replace function public.partner_event_sales(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; event_row public.events; internal jsonb; legacy jsonb;
begin
  if not public.partner_has_event(p_event_id) then
    raise exception 'Event not found.' using errcode='P0002';
  end if;
  select * into event_row from public.events where id=p_event_id;
  -- Aggregate only. Buyer identities, ticket codes and payment IDs never leave
  -- this function. Keep currencies separate and avoid joining orders to tickets
  -- when summing money (which would multiply the order total).
  select coalesce(jsonb_agg(x),'[]'::jsonb) into internal from (
    select upper(o.currency) currency,
      count(*) filter(where coalesce(o.checkout_kind,'paid')<>'comp') paid_orders,
      coalesce(sum(o.total_cents) filter(where coalesce(o.checkout_kind,'paid')<>'comp'),0) gross_collected_cents,
      coalesce(sum(o.refunded_cents) filter(where coalesce(o.checkout_kind,'paid')<>'comp'),0) refunded_cents,
      coalesce(sum(o.total_cents-o.refunded_cents) filter(where coalesce(o.checkout_kind,'paid')<>'comp'),0) net_collected_cents
    from public.orders o where o.event_id=p_event_id and o.status in ('paid','partial_refund','refunded')
    group by upper(o.currency)
  ) x;
  select jsonb_build_object(
    'tickets_issued',count(*),
    'tickets_valid',count(*) filter(where t.status in ('valid','used')),
    'tickets_used',count(*) filter(where t.status='used'),
    'tickets_refunded',count(*) filter(where t.status='refunded'),
    'complimentary_tickets',count(*) filter(where o.checkout_kind='comp')
  ) into result from public.tickets t join public.orders o on o.id=t.order_id
    where t.event_id=p_event_id and o.event_id=p_event_id and o.status in ('paid','partial_refund','refunded');
  -- Ticket Tailor history is a separately labeled cached summary. Never call
  -- it live or add it to internal sales, which could double-count imports.
  select coalesce(jsonb_agg(jsonb_build_object(
    'currency',d.currency,'tickets_sold',d.tickets_sold,'orders_count',d.orders_count,
    'gross_cents',d.gross_cents,'fees_cents',d.fees_cents,'net_cents',d.net_cents,
    'fetched_at',d.fetched_at
  )),'[]'::jsonb) into legacy from public.tt_discovered_events d
    where d.local_event_id=p_event_id and d.status='ok';
  return jsonb_build_object(
    'event',jsonb_build_object('id',event_row.id,'title',event_row.title,'event_date',event_row.event_date,'event_time',event_row.event_time,'image_url',event_row.image_url,'status',event_row.status,'ticketing_mode',event_row.ticketing_mode),
    'internal',result||jsonb_build_object('currencies',internal),
    'ticket_tailor',legacy,'as_of',now()
  );
end $$;
revoke all on function public.partner_event_sales(uuid) from public,anon;
grant execute on function public.partner_event_sales(uuid) to authenticated;
commit;
