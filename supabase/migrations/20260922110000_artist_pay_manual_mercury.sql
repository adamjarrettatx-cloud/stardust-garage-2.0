-- Manual recipient onboarding only. No account/routing numbers, last-four,
-- recipient API payloads, or banking forms. Service-role writes exclusively.
begin;

create table public.contact_payout_profiles (
  contact_id uuid primary key references public.contacts(id) on delete restrict,
  mercury_recipient_id uuid not null unique,
  linked_at timestamptz not null default now(),
  linked_by uuid references auth.users(id) on delete set null
);
alter table public.contact_payout_profiles enable row level security;
revoke all on public.contact_payout_profiles from public, anon, authenticated;
grant all on public.contact_payout_profiles to service_role;

create table public.artist_pay_payouts (
  pay_request_id uuid primary key references public.artist_pay_requests(id) on delete restrict,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  mercury_recipient_id uuid not null,
  mercury_account_id uuid not null,
  environment text not null check (environment in ('sandbox', 'production')),
  amount_cents integer not null check (amount_cents > 0),
  idempotency_key uuid not null unique default gen_random_uuid(),
  mercury_request_id uuid unique,
  status text not null default 'unknown' check (status in (
    'unknown', 'pending_approval', 'approved', 'rejected', 'cancelled'
  )),
  lease_token uuid,
  lease_until timestamptz,
  last_error_code text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'unknown' and mercury_request_id is null)
    or (status <> 'unknown' and mercury_request_id is not null))
);
alter table public.artist_pay_payouts enable row level security;
revoke all on public.artist_pay_payouts from public, anon, authenticated;
grant all on public.artist_pay_payouts to service_role;

alter table public.artist_pay_audit_log drop constraint artist_pay_audit_log_action_check;
alter table public.artist_pay_audit_log add constraint artist_pay_audit_log_action_check
  check (action in (
    'pay_requested', 'pay_approved', 'pay_rejected', 'pay_reopened',
    'mercury_recipient_linked', 'mercury_submission_started',
    'mercury_status_updated', 'mercury_submission_unconfirmed'
  ));
-- Money-adjacent audit history must not be forgeable through PostgREST.
drop policy if exists "Team can insert pay audit rows" on public.artist_pay_audit_log;

create function public.link_artist_mercury_recipient(
  p_contact_id uuid, p_recipient_id uuid, p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_profile public.contact_payout_profiles;
begin
  perform 1 from public.contacts where id = p_contact_id for update;
  if not found then raise exception 'contact_not_found'; end if;
  select * into v_profile from public.contact_payout_profiles where contact_id = p_contact_id;
  if v_profile.mercury_recipient_id = p_recipient_id then return to_jsonb(v_profile); end if;
  if exists (select 1 from public.artist_pay_payouts
    where contact_id = p_contact_id and status not in ('rejected', 'cancelled')) then
    raise exception 'payout_in_progress';
  end if;
  insert into public.contact_payout_profiles(contact_id, mercury_recipient_id, linked_by)
  values (p_contact_id, p_recipient_id, p_actor_id)
  on conflict (contact_id) do update set
    mercury_recipient_id = excluded.mercury_recipient_id, linked_at = now(), linked_by = p_actor_id
  returning * into v_profile;
  insert into public.artist_pay_audit_log(action, actor_id, details)
  values ('mercury_recipient_linked', p_actor_id,
    jsonb_build_object('contact_id', p_contact_id, 'mercury_recipient_id', p_recipient_id));
  return to_jsonb(v_profile);
end;
$$;

-- Lock + durable snapshot BEFORE the network call. Lease covers both queue
-- and refresh, so stale responses cannot overwrite a newer observation.
create function public.claim_artist_mercury_payout(
  p_request_id uuid, p_actor_id uuid, p_account_id uuid, p_environment text,
  p_refresh boolean default false, p_expected_recipient_id uuid default null,
  p_expected_amount_cents integer default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_request public.artist_pay_requests;
  v_profile public.contact_payout_profiles;
  v_payout public.artist_pay_payouts;
  v_lease uuid := gen_random_uuid();
begin
  select * into v_request from public.artist_pay_requests where id = p_request_id for update;
  if not found then raise exception 'request_not_found'; end if;
  if v_request.status <> 'approved' then raise exception 'request_not_approved'; end if;
  -- Same lock as linking: changing a recipient and creating a payout serialize.
  perform 1 from public.contacts where id = v_request.contact_id for update;
  select * into v_payout from public.artist_pay_payouts where pay_request_id = p_request_id for update;

  if v_payout.pay_request_id is not null then
    if v_payout.environment <> p_environment or v_payout.mercury_account_id <> p_account_id then
      raise exception 'mercury_config_changed';
    end if;
    if not p_refresh and v_payout.mercury_request_id is not null then
      return jsonb_build_object('payout', to_jsonb(v_payout), 'skip', true);
    end if;
    if v_payout.lease_until > now() then raise exception 'payout_busy'; end if;
  end if;

  if p_refresh then
    if v_payout.mercury_request_id is null then raise exception 'no_mercury_request'; end if;
  else
    -- Missing/false/error all fail closed. Approval itself does not require W9.
    perform 1 from public.contact_tax_profiles
      where contact_id = v_request.contact_id and w9_on_file is true for share;
    if not found then raise exception 'w9_required'; end if;
    if v_payout.pay_request_id is null then
      select * into v_profile from public.contact_payout_profiles where contact_id = v_request.contact_id;
      if not found then raise exception 'recipient_required'; end if;
      insert into public.artist_pay_payouts (
        pay_request_id, contact_id, mercury_recipient_id, mercury_account_id,
        environment, amount_cents, created_by
      ) values (
        p_request_id, v_request.contact_id, v_profile.mercury_recipient_id,
        p_account_id, p_environment, v_request.amount_cents, p_actor_id
      ) returning * into v_payout;
    end if;
  end if;

  if not p_refresh and (
    p_expected_recipient_id is distinct from v_payout.mercury_recipient_id
    or p_expected_amount_cents is distinct from v_payout.amount_cents
  ) then raise exception 'confirmation_changed'; end if;

  update public.artist_pay_payouts set
    lease_token = v_lease, lease_until = now() + interval '2 minutes', updated_at = now()
    where pay_request_id = p_request_id returning * into v_payout;
  insert into public.artist_pay_audit_log(action, request_id, booking_id, actor_id, details)
  values ('mercury_submission_started', p_request_id, v_request.booking_id, p_actor_id,
    jsonb_build_object('refresh', p_refresh, 'idempotency_key', v_payout.idempotency_key,
      'amount_cents', v_payout.amount_cents, 'environment', v_payout.environment));
  return jsonb_build_object('payout', to_jsonb(v_payout), 'skip', false, 'lease_token', v_lease);
end;
$$;

create function public.finish_artist_mercury_payout(
  p_request_id uuid, p_lease_token uuid, p_actor_id uuid,
  p_mercury_request_id uuid, p_status text, p_error_code text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_payout public.artist_pay_payouts;
begin
  select * into v_payout from public.artist_pay_payouts where pay_request_id = p_request_id for update;
  if not found or v_payout.lease_token is distinct from p_lease_token
    or p_lease_token is null then raise exception 'payout_lease_lost'; end if;
  if p_error_code is null then
    if p_mercury_request_id is null or p_status not in ('pending_approval', 'approved', 'rejected', 'cancelled')
      or p_status is null then raise exception 'invalid_mercury_result'; end if;
    if v_payout.mercury_request_id is not null and v_payout.mercury_request_id <> p_mercury_request_id then
      raise exception 'mercury_request_mismatch';
    end if;
    -- Terminal observations cannot regress to pending or a different outcome.
    if v_payout.status in ('approved', 'rejected', 'cancelled') and v_payout.status <> p_status then
      raise exception 'mercury_status_conflict';
    end if;
    update public.artist_pay_payouts set
      mercury_request_id = p_mercury_request_id, status = p_status
      where pay_request_id = p_request_id;
  end if;
  update public.artist_pay_payouts set
    last_error_code = left(p_error_code, 80), lease_token = null, lease_until = null, updated_at = now()
    where pay_request_id = p_request_id returning * into v_payout;
  insert into public.artist_pay_audit_log(action, request_id, actor_id, details)
  values (
    case when p_error_code is null then 'mercury_status_updated' else 'mercury_submission_unconfirmed' end,
    p_request_id, p_actor_id, jsonb_build_object('status', v_payout.status,
      'mercury_request_id', v_payout.mercury_request_id, 'error_code', left(p_error_code, 80))
  );
  -- Do not mark the booking/request paid: approval is NOT settlement.
  return to_jsonb(v_payout);
end;
$$;

revoke all on function public.link_artist_mercury_recipient(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_artist_mercury_payout(uuid, uuid, uuid, text, boolean, uuid, integer) from public, anon, authenticated;
revoke all on function public.finish_artist_mercury_payout(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.link_artist_mercury_recipient(uuid, uuid, uuid) to service_role;
grant execute on function public.claim_artist_mercury_payout(uuid, uuid, uuid, text, boolean, uuid, integer) to service_role;
grant execute on function public.finish_artist_mercury_payout(uuid, uuid, uuid, uuid, text, text) to service_role;

-- Preserve September's optional-slot/hours_worked behavior, adding only the
-- deterministic newest-request tiebreaker and explicit anonymous revocation.
create or replace function public.partner_bookings()
returns table (
  id uuid, event_id uuid, event_title text, event_date date, event_time text,
  slot_start timestamptz, slot_end timestamptz, pay_type text,
  hourly_rate_cents integer, flat_amount_cents integer, amount_cents integer,
  status text, pay_request_id uuid, pay_request_status text, rejection_reason text
)
language sql stable security definer set search_path = public, auth as $$
  select b.id, b.event_id, e.title, e.event_date, e.event_time,
    b.slot_start, b.slot_end, b.pay_type, b.hourly_rate_cents, b.flat_amount_cents,
    case
      when b.pay_type = 'flat' then b.flat_amount_cents
      when b.hours_worked is not null then round(b.hourly_rate_cents * b.hours_worked)::integer
      when b.slot_start is not null and b.slot_end is not null
        then round(b.hourly_rate_cents * (extract(epoch from (b.slot_end - b.slot_start)) / 3600.0))::integer
      else null
    end,
    b.status, pr.id, pr.status, pr.rejection_reason
  from public.event_bookings b join public.events e on e.id = b.event_id
  left join lateral (
    select apr.id, apr.status, apr.rejection_reason from public.artist_pay_requests apr
    where apr.booking_id = b.id order by apr.created_at desc, apr.id desc limit 1
  ) pr on true
  where b.contact_id = public.partner_contact_id()
  order by coalesce(b.slot_start, e.event_date::timestamptz) desc;
$$;
revoke all on function public.partner_bookings() from public, anon;
grant execute on function public.partner_bookings() to authenticated;

commit;
