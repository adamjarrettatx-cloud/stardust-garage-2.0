-- Server-only refund intent ledger. A review never moves money. Claiming an
-- intent serializes by order; Stripe writes use the durable request UUID.
create table public.ticket_refund_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  actor_user_id uuid not null references auth.users(id),
  amount_cents bigint not null check (amount_cents > 0),
  expected_refunded_cents bigint not null check (expected_refunded_cents >= 0),
  currency text not null,
  note text not null default '' check (length(note) <= 500),
  status text not null default 'draft'
    check (status in ('draft', 'processing', 'pending', 'succeeded', 'failed')),
  stripe_refund_id text unique,
  stripe_status text,
  error text,
  applied_cents bigint not null default 0 check (applied_cents >= 0),
  started_at timestamptz,
  lease_expires_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ticket_refund_requests_order_idx on public.ticket_refund_requests(order_id, created_at desc);
create unique index ticket_refund_one_active_order on public.ticket_refund_requests(order_id)
  where status in ('processing', 'pending');
alter table public.ticket_refund_requests enable row level security;
revoke all on public.ticket_refund_requests from public, anon, authenticated;
grant select, insert, update on public.ticket_refund_requests to service_role;

create or replace function public.claim_ticket_refund(p_id uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.ticket_refund_requests;
  o public.orders;
  target uuid;
begin
  select order_id into target from public.ticket_refund_requests where id = p_id;
  if target is null then raise exception 'Refund request not found'; end if;
  -- Every refund RPC locks order before request to avoid lock-order deadlocks.
  select * into o from public.orders where id = target for update;
  select * into r from public.ticket_refund_requests where id = p_id for update;
  if r.actor_user_id <> p_actor then raise exception 'Refund request belongs to another administrator'; end if;
  if r.status in ('succeeded', 'failed') then
    return jsonb_build_object('request', to_jsonb(r), 'order', to_jsonb(o));
  end if;
  if r.lease_expires_at > now() then raise exception 'This request is already processing. Wait 90 seconds, then check its status.'; end if;
  if r.status in ('processing', 'pending') then
    update public.ticket_refund_requests set lease_expires_at = now() + interval '90 seconds', updated_at = now()
      where id = r.id returning * into r;
    return jsonb_build_object('request', to_jsonb(r), 'order', to_jsonb(o));
  end if;
  if r.created_at < now() - interval '15 minutes' then raise exception 'Review expired. Review the order again.'; end if;
  if o.status not in ('paid', 'partial_refund') or o.stripe_payment_intent_id is null
    or o.total_cents <= coalesce(o.refunded_cents, 0) then
    raise exception 'Order is not refundable';
  end if;
  if o.currency <> r.currency or coalesce(o.refunded_cents, 0) <> r.expected_refunded_cents
    or r.amount_cents > o.total_cents - coalesce(o.refunded_cents, 0) then
    raise exception 'Order balance changed. Review the order again.';
  end if;
  if exists (select 1 from public.ticket_refund_requests
      where order_id = o.id and id <> r.id and status in ('processing', 'pending')) then
    raise exception 'Another refund is in progress for this order. Check its status first.';
  end if;
  update public.ticket_refund_requests set status = 'processing', started_at = now(),
    lease_expires_at = now() + interval '90 seconds', updated_at = now()
    where id = r.id returning * into r;
  insert into public.ticket_audit_log(event_id, order_id, actor_user_id, actor_role, action, detail)
    values (o.event_id, o.id, p_actor, 'admin', 'refund.requested',
      jsonb_build_object('request_id', r.id, 'amount_cents', r.amount_cents, 'note', r.note));
  return jsonb_build_object('request', to_jsonb(r), 'order', to_jsonb(o));
end;
$$;

-- Called only with a provider-verified refund or definitive provider rejection.
-- Accounting is a delta against applied_cents, so replays cannot add twice.
-- Late failures reverse that delta; previously invalidated tickets stay invalid
-- pending deliberate operator review rather than silently restoring admission.
create or replace function public.finish_ticket_refund(
  p_id uuid, p_refund_id text, p_status text, p_error text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.ticket_refund_requests;
  o public.orders;
  target uuid;
  state text;
  applied bigint;
  new_total bigint;
  new_tax bigint;
  ticket_ids uuid[];
begin
  if p_status not in ('succeeded', 'pending', 'requires_action', 'failed', 'canceled') then
    raise exception 'Unsupported refund status';
  end if;
  select order_id into target from public.ticket_refund_requests where id = p_id;
  if target is null then raise exception 'Refund request not found'; end if;
  select * into o from public.orders where id = target for update;
  select * into r from public.ticket_refund_requests where id = p_id for update;
  if r.status = 'draft' then raise exception 'Refund has not been confirmed'; end if;
  if r.stripe_refund_id is not null and r.stripe_refund_id is distinct from p_refund_id then
    raise exception 'Refund reference mismatch';
  end if;
  if p_refund_id is null and (p_status <> 'failed' or r.stripe_refund_id is not null) then
    raise exception 'Missing refund reference';
  end if;
  -- Provider failures/cancellations are terminal. Ignore an older succeeded
  -- response arriving after a failure webhook, and stale pending responses
  -- arriving after success. requires_action may legitimately follow success.
  if r.stripe_status in ('failed', 'canceled') and r.stripe_refund_id is not null then
    return to_jsonb(r);
  end if;
  if r.stripe_status = 'succeeded' and p_status = 'pending' then return to_jsonb(r); end if;
  state := case when p_status = 'succeeded' then 'succeeded'
                when p_status in ('failed', 'canceled') then 'failed' else 'pending' end;
  applied := case when state = 'succeeded' then r.amount_cents else 0 end;
  new_total := coalesce(o.refunded_cents, 0) + applied - r.applied_cents;
  if new_total < 0 or new_total > o.total_cents then raise exception 'Refund accounting mismatch'; end if;
  if applied <> r.applied_cents then
    new_tax := case when new_total = o.total_cents then coalesce(o.tax_cents, 0)
      else floor(coalesce(o.tax_cents, 0)::numeric * new_total / nullif(o.total_cents, 0))::bigint end;
    update public.orders set refunded_cents = new_total, refunded_tax_cents = coalesce(new_tax, 0),
      status = case when new_total = o.total_cents then 'refunded' when new_total > 0 then 'partial_refund' else 'paid' end,
      refunded_at = case when new_total = o.total_cents then now() else null end,
      updated_at = now()
      where id = o.id;
  end if;
  -- Invalidate remaining unused tickets only after confirmed full refund.
  if state = 'succeeded' and new_total = o.total_cents then
    with changed as (
      update public.tickets set status = 'refunded', refunded_at = now(), updated_at = now()
        where order_id = o.id and status = 'valid' returning id
    ) select array_agg(id) into ticket_ids from changed;
  end if;
  if r.stripe_status is distinct from p_status or r.stripe_refund_id is distinct from p_refund_id then
    insert into public.ticket_audit_log(event_id, order_id, actor_user_id, actor_role, action, detail)
      values (o.event_id, o.id, r.actor_user_id, 'admin', 'refund.' || state,
        jsonb_build_object('request_id', r.id, 'stripe_refund_id', p_refund_id,
          'amount_cents', r.amount_cents, 'stripe_status', p_status,
          'accounting_delta_cents', applied - r.applied_cents,
          'invalidated_ticket_ids', coalesce(to_jsonb(ticket_ids), '[]'::jsonb),
          'error', p_error));
  end if;
  update public.ticket_refund_requests set status = state, stripe_status = p_status,
    stripe_refund_id = p_refund_id, applied_cents = applied, error = p_error,
    lease_expires_at = null, updated_at = now()
    where id = r.id returning * into r;
  return to_jsonb(r);
end;
$$;

revoke all on function public.claim_ticket_refund(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finish_ticket_refund(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_ticket_refund(uuid, uuid) to service_role;
grant execute on function public.finish_ticket_refund(uuid, text, text, text) to service_role;
