-- Migration: chat_owner_only_moderation
--
-- Owner decision (2026-08-29): one person moderates Team Chat. The owner can
-- delete ANY message — in a group channel or in a DM — and can delete a whole
-- channel. Nobody else can delete anything, including their own messages.
--
-- Before this migration the deployed policies did not match that:
--
--   * "senders can edit or soft-delete their own messages" let any team member
--     set deleted_at on their own chat_messages row (and rewrite its body)
--     straight through PostgREST.
--   * "members can leave a channel" let any team member delete their own
--     chat_channel_members row, removing a channel the owner created from their
--     own sidebar. Channel membership is the owner's structure to decide.
--   * chat_channels had no DELETE policy at all, so a channel could never be
--     removed except with the service-role key.
--
-- The identity rule is unchanged and still lives in one place:
-- public.is_chat_channel_admin() (20260802_team_chat_channel_admin_and_unread.sql)
-- — admin in the server-controlled team_members table AND signed in as one of
-- the owner's two addresses. What changes here is its REACH: it used to gate
-- group-channel creation only, and now gates every destructive action in chat.
-- Deliberately still not public.is_owner(), which also guards the financial
-- ledger; widening that would hand admin@sdgatx.com whole-business cash flow as
-- a side effect.
--
-- Every policy below is written RESTRICTIVE. A permissive policy is OR'd with
-- every other permissive policy on the table, so re-adding something like
-- "senders can delete their own messages" later would silently reopen the hole.
-- A restrictive policy is AND'd with all of them, so the owner-only rule holds
-- regardless of what else accumulates on these tables.

comment on function public.is_chat_channel_admin() is
  'True only for the owner''s admin account. The single authority over Team Chat: creating group channels, deleting messages (anyone''s), deleting channels, and changing channel membership. See supabase/migrations/20260829_chat_owner_only_moderation.sql.';

-- ---------------------------------------------------------------------------
-- 1. Who deleted it
-- ---------------------------------------------------------------------------
-- Deletion is a soft delete: deleted_at is set and the row stays. The UI
-- filters `deleted_at is null`, so a deleted message disappears for everyone
-- with no placeholder left behind (owner's choice), but the record is still
-- there if a conversation ever has to be reconstructed. deleted_by records
-- which account did it, so that history is attributable rather than anonymous.
alter table public.chat_messages
  add column if not exists deleted_by uuid references auth.users(id);

create index if not exists chat_messages_deleted_at_idx
  on public.chat_messages (channel_id, deleted_at)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. Messages: only the owner may change or remove one
-- ---------------------------------------------------------------------------
-- Dropped, not narrowed: this policy was the sender's own edit/delete grant,
-- and there is no version of it that survives "only me, ever".
drop policy if exists "senders can edit or soft-delete their own messages" on public.chat_messages;

drop policy if exists chat_messages_update_owner_only on public.chat_messages;
create policy chat_messages_update_owner_only on public.chat_messages
  for update to authenticated
  using (public.is_chat_channel_admin())
  with check (public.is_chat_channel_admin());

drop policy if exists chat_messages_update_owner_only_restrictive on public.chat_messages;
create policy chat_messages_update_owner_only_restrictive on public.chat_messages
  as restrictive for update to authenticated
  using (public.is_chat_channel_admin())
  with check (public.is_chat_channel_admin());

-- chat_messages has no permissive DELETE policy, so a hard delete is already
-- refused for everyone. This keeps it that way if one is ever added: the
-- sanctioned path is the soft delete above, which the owner performs through
-- DELETE /api/team/chat/messages/[id].
drop policy if exists chat_messages_delete_owner_only on public.chat_messages;
create policy chat_messages_delete_owner_only on public.chat_messages
  as restrictive for delete to authenticated
  using (public.is_chat_channel_admin());

-- ---------------------------------------------------------------------------
-- 3. Channels: only the owner may remove one
-- ---------------------------------------------------------------------------
-- Deleting a channel row cascades to its messages and its membership rows
-- (chat_messages_channel_id_fkey and chat_channel_members_channel_id_fkey are
-- both ON DELETE CASCADE), so this one policy governs the whole teardown.
-- Unlike a message, a channel is hard-deleted: there is no "channel with no
-- rows" state the UI could render, and the owner is asked to type the channel
-- name before the API route will do it.
alter table public.chat_channels enable row level security;

drop policy if exists chat_channels_delete_owner_only on public.chat_channels;
create policy chat_channels_delete_owner_only on public.chat_channels
  for delete to authenticated
  using (public.is_chat_channel_admin());

drop policy if exists chat_channels_delete_owner_only_restrictive on public.chat_channels;
create policy chat_channels_delete_owner_only_restrictive on public.chat_channels
  as restrictive for delete to authenticated
  using (public.is_chat_channel_admin());

-- ---------------------------------------------------------------------------
-- 4. Membership is the owner's to decide
-- ---------------------------------------------------------------------------
-- "members can leave a channel" was a permissive DELETE on chat_channel_members
-- keyed to user_id = auth.uid(). Nothing in the app ever called it — there is no
-- Leave button — but it meant a team member could remove themselves from a
-- channel the owner had put them in, which is the same authority as deleting the
-- channel for themselves.
--
-- The UPDATE policy stays exactly as it is: that is how a member's own
-- last_read_at advances, which is what drives every unread badge. Read state is
-- not moderation.
drop policy if exists "members can leave a channel" on public.chat_channel_members;

drop policy if exists chat_channel_members_delete_owner_only on public.chat_channel_members;
create policy chat_channel_members_delete_owner_only on public.chat_channel_members
  for delete to authenticated
  using (public.is_chat_channel_admin());

drop policy if exists chat_channel_members_delete_owner_only_restrictive on public.chat_channel_members;
create policy chat_channel_members_delete_owner_only_restrictive on public.chat_channel_members
  as restrictive for delete to authenticated
  using (public.is_chat_channel_admin());

-- ---------------------------------------------------------------------------
-- 5. Deletions have to reach other people's open windows
-- ---------------------------------------------------------------------------
-- chat_messages was already published for realtime, so the soft delete arrives
-- as an UPDATE and the client drops the message live. chat_channels was not
-- published, which would have left a deleted channel sitting in every other
-- teammate's sidebar until they reloaded — clicking it would then load an empty
-- thread. Publishing the table makes the removal propagate.
--
-- Postgres sends a DELETE with only the primary key unless REPLICA IDENTITY is
-- FULL, and the channel id is all the client needs to drop the row.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_channels'
  ) then
    alter publication supabase_realtime add table public.chat_channels;
  end if;
end $$;
