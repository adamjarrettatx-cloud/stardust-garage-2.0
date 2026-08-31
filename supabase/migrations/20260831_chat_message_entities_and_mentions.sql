-- Migration: chat_message_entities_and_mentions
--
-- Adds structured entity references to Team Chat messages so a message can
-- link a real event record and mention a real team member, and adds the
-- mention-specific attention state (badge, "Mentions" view, jump-to-message)
-- that a mention has to earn to be worth anything.
--
-- The design rule this migration exists to enforce: the stored source of truth
-- is the ID, never the label. `body_text` (the existing `body` column) holds the
-- sentence exactly as it reads on screen — "Is the event Mr. Untz already
-- locked in on contract for Naish" — with no @ or # markers left in it, and
-- `entities` holds the offsets that turn spans of that sentence back into a
-- link or a mention pill at render time. Rename an event tomorrow and every
-- message that referenced it still resolves, because the id never moved.
--
-- Three new columns on public.chat_messages:
--
--   entities jsonb            -- [{ type, id, label, start, end }, ...]
--   mentioned_user_ids uuid[] -- flattened from entities, DERIVED SERVER-SIDE
--   linked_event_ids uuid[]   -- flattened from entities, DERIVED SERVER-SIDE
--
-- The two flattened arrays are what queries and indexes use ("every message
-- mentioning me", "every message that references this event"). They are NOT
-- accepted from the client: the trigger below recomputes them from `entities`
-- on every insert and update, so they can never drift out of agreement with the
-- entity offsets, and a hand-made PostgREST call cannot claim a mention it did
-- not actually write into the message.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table public.chat_messages
  add column if not exists entities jsonb not null default '[]'::jsonb,
  add column if not exists mentioned_user_ids uuid[] not null default '{}'::uuid[],
  add column if not exists linked_event_ids uuid[] not null default '{}'::uuid[];

-- `entities` must be a JSON array. Anything else (an object, a string, a bare
-- number) would make every reader defensive about a shape that should be
-- impossible, so it is rejected at the door instead.
alter table public.chat_messages drop constraint if exists chat_messages_entities_is_array;
alter table public.chat_messages
  add constraint chat_messages_entities_is_array
  check (jsonb_typeof(entities) = 'array');

-- A message carrying nothing but entity metadata and no readable text is not a
-- message. The existing chat_messages_body_check ("text OR an image") already
-- covers this, so it is deliberately left alone.

-- Supports "every message that references this event" (an event page could
-- later show its chat history) and "every message mentioning me".
create index if not exists chat_messages_mentioned_user_ids_idx
  on public.chat_messages using gin (mentioned_user_ids);
create index if not exists chat_messages_linked_event_ids_idx
  on public.chat_messages using gin (linked_event_ids);

-- ---------------------------------------------------------------------------
-- 2. Server-derived flattening of entities -> id arrays
-- ---------------------------------------------------------------------------
--
-- Runs BEFORE insert/update, so the row that lands is always self-consistent.
--
-- NOT security definer, on purpose. It runs with the caller's privileges, which
-- means the `events` lookup below is evaluated under the caller's RLS: an event
-- the sender cannot see (RLS on public.events grants team members every event,
-- and the public only published+public ones) simply never makes it into
-- linked_event_ids. That is the permission rule for event linking, enforced in
-- the database rather than trusted from the composer.
--
-- An id in `entities` that fails to resolve is left in `entities` untouched — it
-- is what lets the UI render the stored label as a safe, non-clickable fallback
-- instead of dropping words out of somebody's sentence.
create or replace function public.chat_messages_flatten_entities()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_users  uuid[] := '{}'::uuid[];
  v_events uuid[] := '{}'::uuid[];
begin
  if jsonb_typeof(new.entities) is distinct from 'array' then
    new.entities := '[]'::jsonb;
  end if;

  -- A malformed id in `entities` would make the uuid casts below raise and take
  -- the whole message insert down with it. Rejecting the message is the wrong
  -- failure: the text a human typed is fine, only the metadata is junk. So the
  -- resolution is wrapped and anything unexpected degrades to "no entities"
  -- rather than a lost message.
  --
  -- Note this must be an inline block, NOT a call to a second trigger function:
  -- PostgreSQL refuses to invoke a function returning `trigger` as an ordinary
  -- expression, so a wrapper of that shape would raise on every single insert
  -- and its own handler would then silently blank every entity.
  begin
    -- Mentions: only real team members, and never the sender mentioning himself
    -- (self-mentions would raise a badge on your own message).
    select coalesce(array_agg(distinct tm.user_id), '{}'::uuid[])
      into v_users
    from jsonb_array_elements(new.entities) e
    join public.team_members tm
      on tm.user_id = nullif(e.value->>'id', '')::uuid
    where e.value->>'type' = 'user'
      and tm.user_id <> new.sender_id;

    -- Event links: only events the sender is actually allowed to read.
    select coalesce(array_agg(distinct ev.id), '{}'::uuid[])
      into v_events
    from jsonb_array_elements(new.entities) e
    join public.events ev
      on ev.id = nullif(e.value->>'id', '')::uuid
    where e.value->>'type' = 'event';
  exception when others then
    new.entities := '[]'::jsonb;
    v_users  := '{}'::uuid[];
    v_events := '{}'::uuid[];
  end;

  new.mentioned_user_ids := v_users;
  new.linked_event_ids   := v_events;

  return new;
end;
$$;

-- The trigger is dropped before the retired function it may still point at, so
-- this migration re-runs cleanly on a database where the earlier shape landed.
drop trigger if exists chat_messages_flatten_entities_trg on public.chat_messages;

-- Retired: see the note above about trigger functions not being callable as
-- ordinary functions. Dropped rather than left in place so no future trigger can
-- be pointed back at it.
drop function if exists public.chat_messages_flatten_entities_safe();

create trigger chat_messages_flatten_entities_trg
  before insert or update of entities, sender_id on public.chat_messages
  for each row execute function public.chat_messages_flatten_entities();

-- ---------------------------------------------------------------------------
-- 3. chat_mentions — the mention-specific attention state
-- ---------------------------------------------------------------------------
--
-- Deliberately its own table rather than a flag on chat_messages, because a
-- mention's read state is PER RECIPIENT: one message mentioning three people is
-- read by one of them and still unread for the other two. It is also what makes
-- a mention notification distinct from an ordinary new-message notification —
-- chat_channel_members.last_read_at already answers "have you seen this
-- channel", which is a different and much weaker question than "has anyone
-- pointed at you".
create table if not exists public.chat_mentions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  mentioned_user_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (message_id, mentioned_user_id)
);

-- The two access patterns: the unread badge / Mentions view for one person
-- (recipient + unread, newest first) and clearing a channel's mentions on open.
create index if not exists chat_mentions_recipient_unread_idx
  on public.chat_mentions (mentioned_user_id, read_at, created_at desc);
create index if not exists chat_mentions_channel_recipient_idx
  on public.chat_mentions (channel_id, mentioned_user_id);

alter table public.chat_mentions enable row level security;

-- You can read your own mentions and nobody else's. There is deliberately no
-- INSERT or DELETE policy at all: rows are only ever created by the
-- security-definer fan-out below and only ever removed by a cascade or the
-- soft-delete cleanup, so no client can manufacture a mention of themselves
-- (or of anyone else) by calling PostgREST directly.
drop policy if exists chat_mentions_select_own on public.chat_mentions;
create policy chat_mentions_select_own on public.chat_mentions
  for select to authenticated
  using (mentioned_user_id = auth.uid());

-- Marking your own mention read is the one write a client may perform, and only
-- through the RPC below. The column grant is what keeps this honest: even with
-- this policy, `read_at` is the only column UPDATE is granted on, so an update
-- cannot quietly re-point a mention at a different message or person.
drop policy if exists chat_mentions_update_own_read_state on public.chat_mentions;
create policy chat_mentions_update_own_read_state on public.chat_mentions
  for update to authenticated
  using (mentioned_user_id = auth.uid())
  with check (mentioned_user_id = auth.uid());

revoke all on table public.chat_mentions from anon, authenticated;
grant select on table public.chat_mentions to authenticated;
grant update (read_at) on table public.chat_mentions to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Mention fan-out
-- ---------------------------------------------------------------------------
--
-- AFTER insert, because it needs the message id, and it must not be able to
-- prevent the message itself from being delivered.
--
-- SECURITY DEFINER so it can write chat_mentions (which no role can insert
-- into) and read the channel roster in full. Every value it writes is pinned to
-- the row that just landed — NEW.id, NEW.channel_id, NEW.sender_id — and the
-- recipient set is intersected with the channel's actual membership, so:
--
--   * a mention of somebody who is not in this conversation notifies nobody,
--     which is the permission rule for mentioning; and
--   * the sender cannot address a notification to an arbitrary user id, because
--     mentioned_user_ids was itself derived server-side in step 2.
--
-- The insert already passed the chat_messages INSERT policy (member of the
-- channel AND sender_id = auth.uid()), so there is no identity left to re-check
-- here.
create or replace function public.chat_messages_fan_out_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is not null
     or new.mentioned_user_ids is null
     or array_length(new.mentioned_user_ids, 1) is null then
    return new;
  end if;

  insert into public.chat_mentions (message_id, mentioned_user_id, channel_id, sender_id, created_at)
  select new.id, ccm.user_id, new.channel_id, new.sender_id, coalesce(new.created_at, now())
  from public.chat_channel_members ccm
  where ccm.channel_id = new.channel_id
    and ccm.user_id = any (new.mentioned_user_ids)
    and ccm.user_id <> new.sender_id
  on conflict (message_id, mentioned_user_id) do nothing;

  return new;
end;
$$;
revoke all on function public.chat_messages_fan_out_mentions() from public, anon, authenticated;

drop trigger if exists chat_messages_fan_out_mentions_trg on public.chat_messages;
create trigger chat_messages_fan_out_mentions_trg
  after insert on public.chat_messages
  for each row execute function public.chat_messages_fan_out_mentions();

-- Soft delete has to take the mention with it. chat_messages rows are never
-- hard-deleted in normal operation (the owner's delete sets deleted_at), so the
-- FK cascade would never fire and a deleted message would leave a permanent
-- unread mention badge pointing at nothing.
create or replace function public.chat_messages_clear_mentions_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from public.chat_mentions where message_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.chat_messages_clear_mentions_on_delete() from public, anon, authenticated;

drop trigger if exists chat_messages_clear_mentions_on_delete_trg on public.chat_messages;
create trigger chat_messages_clear_mentions_on_delete_trg
  after update of deleted_at on public.chat_messages
  for each row execute function public.chat_messages_clear_mentions_on_delete();

-- ---------------------------------------------------------------------------
-- 5. Read-state RPCs
-- ---------------------------------------------------------------------------
--
-- Kept as a NEW function rather than widening public.chat_unread_counts(),
-- which already feeds the admin sidebar badge and lib/chat.js. Changing that
-- function's return type would mean dropping and recreating it, and a mention
-- count is a different number with different semantics — an unread mention
-- survives you glancing at the channel, an unread message does not.
--
-- SECURITY: definer so it can count across chat_mentions in bulk, but it takes
-- no argument and every branch is pinned to auth.uid(), so a caller cannot ask
-- for anyone else's mentions.
create or replace function public.chat_mention_unread_counts()
returns table (channel_id uuid, unread_count integer)
language sql stable security definer
set search_path = public
as $$
  select m.channel_id, count(*)::integer
  from public.chat_mentions m
  where m.mentioned_user_id = auth.uid()
    and m.read_at is null
  group by m.channel_id;
$$;
revoke all on function public.chat_mention_unread_counts() from public, anon;
grant execute on function public.chat_mention_unread_counts() to authenticated;

-- Clears the mention badge for one conversation. Scoped to the caller's own
-- rows and to `read_at` only; passing somebody else's channel id is harmless
-- because it matches none of their rows.
create or replace function public.chat_mark_mentions_read(p_channel_id uuid)
returns integer
language plpgsql volatile security definer
set search_path = public
as $$
declare
  affected integer;
begin
  if auth.uid() is null then
    return 0;
  end if;

  update public.chat_mentions
     set read_at = now()
   where mentioned_user_id = auth.uid()
     and read_at is null
     and (p_channel_id is null or channel_id = p_channel_id);

  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke all on function public.chat_mark_mentions_read(uuid) from public, anon;
grant execute on function public.chat_mark_mentions_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Event lookup for the # autocomplete
-- ---------------------------------------------------------------------------
--
-- The composer's event search runs as an ordinary RLS-scoped select against
-- public.events (team members already read every event; see "Team can view all
-- events"), so no privileged search function is needed and nothing new is
-- exposed. This index is what keeps the prefix/substring match fast as the
-- events table grows.
create extension if not exists pg_trgm;
create index if not exists events_title_trgm_idx
  on public.events using gin (title gin_trgm_ops);

-- Upcoming-first ordering for the autocomplete's default (unfiltered) list.
create index if not exists events_event_date_desc_idx
  on public.events (event_date desc);
