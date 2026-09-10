-- Preserve the unlisted-event capability on a pending checkout and release
-- public holds that lose access when an administrator makes the event unlisted.
alter table public.ticket_holds
  add column if not exists share_token text,
  add column if not exists released_reason text;

create index if not exists ticket_holds_pending_event_share_token_idx
  on public.ticket_holds (event_id, share_token)
  where status = 'pending';

-- The event editor writes directly through the authenticated Supabase client,
-- so this database trigger is the authoritative update path. It also covers
-- future admin tools without relying on each caller to remember this cleanup.
create or replace function public.release_public_holds_on_unlisted_visibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold record;
begin
  if old.visibility = 'public' and new.visibility = 'unlisted' then
    for v_hold in
      select id
      from public.ticket_holds
      where event_id = new.id
        and status = 'pending'
        and (share_token is null or share_token <> new.share_token)
      for update
    loop
      -- Mark first so a webhook replay can safely retry its idempotent Stripe
      -- refund if the provider call initially fails.
      update public.ticket_holds
      set released_reason = 'visibility_changed'
      where id = v_hold.id;

      -- Use the existing RPC rather than a bare status UPDATE so reserved
      -- inventory is returned atomically with the hold release.
      perform public.release_ticket_hold(v_hold.id);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists events_release_public_holds_on_unlisted on public.events;
create trigger events_release_public_holds_on_unlisted
  after update of visibility on public.events
  for each row
  execute function public.release_public_holds_on_unlisted_visibility();
