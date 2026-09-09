-- Replace enumerable unlisted-event table reads with a high-entropy share-token
-- capability. Tokens are generated for every event so the column can remain
-- NOT NULL; only published unlisted rows are resolvable through the RPC below.
alter table public.events add column if not exists share_token text;

update public.events
set share_token = translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_')
where visibility = 'unlisted' and share_token is null;

-- Public/internal legacy rows must also be non-null before adding the invariant.
update public.events
set share_token = translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_')
where share_token is null;

alter table public.events
  alter column share_token set default translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_'),
  alter column share_token set not null;

create unique index if not exists events_share_token_key on public.events (share_token);

-- Remove both names because an environment may have stopped between the two
-- preceding visibility migrations.
drop policy if exists "Public can view published public or unlisted events" on public.events;
drop policy if exists "Public can view published public events" on public.events;

create policy "Public can view published public events" on public.events
  for select to public
  using (status = 'published' and visibility = 'public');

create or replace function public.get_event_by_share_token(token text)
returns setof public.events
language sql
stable
security definer
set search_path = public
as $$
  select e.*
  from public.events e
  where e.share_token = token
    and e.status = 'published'
    and e.visibility = 'unlisted';
$$;

revoke all on function public.get_event_by_share_token(text) from public;
grant execute on function public.get_event_by_share_token(text) to anon, authenticated;
