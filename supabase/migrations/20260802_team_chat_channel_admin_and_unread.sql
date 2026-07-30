-- Migration: team_chat_channel_admin_and_unread
--
-- Two changes to the already-deployed Team Chat schema (public.chat_channels,
-- public.chat_channel_members, public.chat_messages and the get_or_create_dm
-- RPC were applied via the Supabase MCP tool before this repo tracked them, so
-- there is no earlier migration file that creates them — this file assumes they
-- exist and will fail loudly against an environment where they do not):
--
--   1. Creating a *group* channel becomes owner-only. Direct messages are
--      untouched: get_or_create_dm() must keep working for every team member.
--   2. A public.chat_unread_counts() RPC so the nav badge and the chat sidebar
--      can count unread messages in one round trip, instead of pulling every
--      message row to the browser and counting there (which silently truncates
--      at PostgREST's default 1000-row ceiling).

-- ---------------------------------------------------------------------------
-- 1. Owner-only group channel creation
-- ---------------------------------------------------------------------------
--
-- Identity rule, mirroring canCreateChatChannel() in lib/chat.js: the caller
-- must be an admin in the server-controlled team_members table AND be signed in
-- as the owner. Both of the owner's addresses are accepted — public.is_owner()
-- (20260723_manual_income_entries.sql) uses adam@sdgatx.com, while the
-- admin@sdgatx.com login is the one that administers Team Chat.
--
-- This is deliberately NOT public.is_owner() itself: is_owner() also guards the
-- financial ledger, so widening its email set to cover admin@sdgatx.com would
-- hand that account whole-business cash flow as a side effect.
--
-- Email comes from auth.users (server-controlled), never from
-- raw_user_meta_data, which end users can edit (Supabase advisor 0015).
create or replace function public.is_chat_channel_admin()
returns boolean language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.team_members tm
    join auth.users u on u.id = tm.user_id
    where tm.user_id = auth.uid()
      and tm.role = 'admin'
      and lower(u.email) in ('admin@sdgatx.com', 'adam@sdgatx.com')
  );
$$;
revoke all on function public.is_chat_channel_admin() from public;
grant execute on function public.is_chat_channel_admin() to authenticated;

alter table public.chat_channels enable row level security;

-- RESTRICTIVE, not permissive. A permissive policy is OR'd with every other
-- permissive policy on the table, so any pre-existing `for insert` or `for all`
-- policy would still let a team member insert a channel by calling PostgREST
-- directly. A restrictive policy is AND'd with all of them, so this rule holds
-- no matter what else is already on the table.
--
-- `type = 'dm'` keeps get_or_create_dm() working for everyone; only group
-- channels are gated. The sanctioned path for creating one is
-- POST /api/team/chat/channels, which uses the service-role client (service_role
-- bypasses RLS) after re-checking the same rule in
-- requireChatChannelAdmin(). This policy is the backstop for a direct API call.
drop policy if exists chat_channels_group_insert_owner_only on public.chat_channels;
create policy chat_channels_group_insert_owner_only on public.chat_channels
  as restrictive for insert to authenticated
  with check (type = 'dm' or public.is_chat_channel_admin());

-- ---------------------------------------------------------------------------
-- 2. Unread counts
-- ---------------------------------------------------------------------------
--
-- Returns one row per channel the caller belongs to, with the number of
-- messages posted by someone else since their last_read_at. A channel with
-- nothing unread comes back as 0 rather than being omitted, so a caller can
-- tell "read" apart from "not a member".
--
-- SECURITY: security definer so it can read chat_messages rows in bulk, but the
-- WHERE clause pins every branch to auth.uid() — there is no argument, so a
-- caller cannot ask for anyone else's counts. Not granted to anon, which has no
-- auth.uid() and therefore no memberships.
create or replace function public.chat_unread_counts()
returns table (channel_id uuid, unread_count integer)
language sql stable security definer
set search_path = public
as $$
  select
    cm.channel_id,
    count(msg.id)::integer
  from public.chat_channel_members cm
  left join public.chat_messages msg
    on msg.channel_id = cm.channel_id
   and msg.deleted_at is null
   and msg.sender_id <> cm.user_id
   and msg.created_at > coalesce(cm.last_read_at, '-infinity'::timestamptz)
  where cm.user_id = auth.uid()
  group by cm.channel_id;
$$;
revoke all on function public.chat_unread_counts() from public;
grant execute on function public.chat_unread_counts() to authenticated;

-- Supports both the unread count above and the sidebar's chronological message
-- load, which are the only two ways chat_messages is ever queried.
create index if not exists chat_messages_channel_created_idx
  on public.chat_messages (channel_id, created_at);
