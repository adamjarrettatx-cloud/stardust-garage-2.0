-- Apply before the still-unpublished atomic admission migration.
-- This is a reservation from automatic buyer redemption, not a named transfer.
alter table public.tickets add column reserved_for_guest boolean not null default false;

create function public.set_ticket_guest_reservation(
  p_actor uuid, p_ticket uuid, p_reserved boolean, p_expected boolean
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  t public.tickets;
  o public.orders;
  verified_email text;
begin
  if p_actor is null or p_reserved is null or p_expected is null then
    raise exception 'Invalid reservation request' using errcode='22023';
  end if;
  select lower(trim(email)) into verified_email from auth.users
    where id=p_actor and email_confirmed_at is not null;
  -- Same row locks as admission: a reservation cannot succeed after redemption.
  -- Scope before locking so another account cannot lock somebody else's tickets.
  select ti.* into t from public.tickets ti join public.orders ord on ord.id=ti.order_id
    where ti.id=p_ticket and (
      ord.user_id=p_actor
      or exists(select 1 from public.member_profiles m where m.id=ord.member_profile_id and m.user_id=p_actor)
      or (ord.user_id is null and verified_email is not null and lower(trim(ord.buyer_email))=verified_email)
    ) for update of ti,ord;
  if t.id is null then
    raise exception 'Ticket not found' using errcode='P0002';
  end if;
  select * into o from public.orders where id=t.order_id;
  if t.status <> 'valid' or o.status not in ('paid','partial_refund') then
    raise exception 'Only an unused valid ticket can be changed. Refresh your tickets.' using errcode='P0001';
  end if;
  if t.reserved_for_guest = p_reserved then
    return jsonb_build_object('id',t.id,'status',t.status,'reserved_for_guest',t.reserved_for_guest);
  end if;
  if t.reserved_for_guest is distinct from p_expected then
    raise exception 'This ticket changed. Refresh your tickets and try again.' using errcode='P0001';
  end if;
  update public.tickets set reserved_for_guest=p_reserved where id=t.id;
  insert into public.ticket_audit_log(event_id,order_id,ticket_id,actor_user_id,actor_role,action,detail)
    values(t.event_id,t.order_id,t.id,p_actor,'customer','ticket.guest_reservation',
      jsonb_build_object('reserved_for_guest',p_reserved,'previous',t.reserved_for_guest));
  return jsonb_build_object('id',t.id,'status',t.status,'reserved_for_guest',p_reserved);
end;
$$;
revoke all on function public.set_ticket_guest_reservation(uuid,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.set_ticket_guest_reservation(uuid,uuid,boolean,boolean) to service_role;

-- Customer writes must use the audited, ownership-checked endpoint, not PostgREST.
create function public.guard_ticket_guest_reservation() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if current_user in ('anon','authenticated') or
    coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' in ('anon','authenticated') then
    if (tg_op='INSERT' and new.reserved_for_guest) or
      (tg_op='UPDATE' and new.reserved_for_guest is distinct from old.reserved_for_guest) then
      raise exception 'Use authenticated guest ticket endpoint' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_ticket_guest_reservation before insert or update on public.tickets
for each row execute function public.guard_ticket_guest_reservation();
revoke all on function public.guard_ticket_guest_reservation() from public,anon,authenticated;
