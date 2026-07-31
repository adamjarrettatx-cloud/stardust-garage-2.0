-- Migration: chat_message_images_and_replies
--
-- Two additions to Team Chat (public.chat_messages), requested so team
-- members can share fliers/screenshots and keep reply context, similar to
-- Slack/iMessage:
--
--   1. image_path: an optional path into the new private chat-images storage
--      bucket. Stored as a path, not a public URL -- the bucket is private,
--      so the browser resolves a path to a short-lived signed URL at render
--      time (createSignedUrl[s]), which itself re-checks the SELECT policy
--      below on every call.
--   2. reply_to_id: an optional self-reference so a message can quote an
--      earlier one. ON DELETE SET NULL because chat_messages rows are
--      soft-deleted (deleted_at) in normal operation, never hard-deleted, but
--      this keeps the column well-defined if that ever changes. No extra RLS
--      is needed for the reference itself: a reply_to_id pointing at a
--      message in a channel the viewer can't read simply won't resolve,
--      because "members can read messages in their channels" already scopes
--      SELECT on chat_messages to the viewer's own channels.
--
-- The existing "body must not be blank" check assumed every message had
-- text. That's relaxed to "body has text OR there's an image" so an
-- image-only message is valid. body keeps NOT NULL, defaulting to ''.

alter table public.chat_messages
  add column if not exists image_path text,
  add column if not exists reply_to_id uuid references public.chat_messages(id) on delete set null;

alter table public.chat_messages alter column body set default '';

alter table public.chat_messages drop constraint if exists chat_messages_body_check;
alter table public.chat_messages
  add constraint chat_messages_body_check
  check (char_length(btrim(body)) > 0 or image_path is not null);

create index if not exists chat_messages_reply_to_id_idx on public.chat_messages (reply_to_id);

-- ---------------------------------------------------------------------------
-- chat-images storage bucket
-- ---------------------------------------------------------------------------
--
-- Private, not public like event-images: Team Chat carries internal fliers
-- and screenshots that can include member/financial details, so access is
-- scoped to members of the SPECIFIC channel a photo was posted in, not to
-- every signed-in user. Upload path convention is `${channel_id}/${filename}`.
--
-- is_chat_image_object_member() pulls the first path segment out of the
-- object name and, only if it looks like a uuid, checks channel membership
-- via the existing public.is_channel_member() (same function the
-- chat_messages/chat_channel_members policies already use). Guarding with the
-- regex match (rather than a bare ::uuid cast in the policy) means a row from
-- an unrelated bucket, or a malformed object name, can never throw a cast
-- error during policy evaluation -- it just evaluates to false.
create or replace function public.is_chat_image_object_member(object_name text, uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  channel_id_text text := split_part(object_name, '/', 1);
begin
  if channel_id_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  return public.is_channel_member(channel_id_text::uuid, uid);
end;
$$;
revoke all on function public.is_chat_image_object_member(text, uuid) from public;
grant execute on function public.is_chat_image_object_member(text, uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', false, 10485760, array['image/jpeg','image/jpg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

drop policy if exists "chat_images_channel_members_select" on storage.objects;
create policy "chat_images_channel_members_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-images' and public.is_chat_image_object_member(name, auth.uid()));

drop policy if exists "chat_images_channel_members_insert" on storage.objects;
create policy "chat_images_channel_members_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-images' and public.is_chat_image_object_member(name, auth.uid()));

drop policy if exists "chat_images_channel_members_delete" on storage.objects;
create policy "chat_images_channel_members_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-images' and public.is_chat_image_object_member(name, auth.uid()));
