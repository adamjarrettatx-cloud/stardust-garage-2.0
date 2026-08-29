import { NextResponse } from 'next/server';
import { requireChatChannelAdmin } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

// DELETE /api/team/chat/messages/[id] — remove any message from Team Chat.
// Owner-only; see requireChatChannelAdmin(). "Any" is the point: a message in a
// group channel, a message in a DM, and a message somebody else wrote are all
// the same operation here. A team member cannot delete even their own message —
// that was the owner's explicit decision — so there is no sender branch below.
//
// Why the service-role client rather than the caller's session: the deployed RLS
// policies allow the owner's own account to update chat_messages, but a soft
// delete also has to strip the attached photo from private storage, and the
// storage policies are scoped to channel membership rather than to moderation.
// One privileged path keeps the row and the object from drifting apart.
//
// Why a soft delete: the thread loader filters `deleted_at is null` and
// chat_unread_counts() already skips deleted rows, so setting deleted_at makes
// the message vanish for everyone with no "message deleted" tombstone left
// behind — which is what the owner asked for — while the row itself stays for
// audit. deleted_by records which account did it.
export async function DELETE(_request, { params }) {
  const { user, unauthorized } = await requireChatChannelAdmin();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing message id' }, { status: 400 });

  const admin = createAdminClient();

  const { data: message, error: lookupError } = await admin
    .from('chat_messages')
    .select('id, channel_id, image_path, deleted_at')
    .eq('id', id)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }

  // Already gone. Answer success so a double-click, a retry after a dropped
  // response, or two open tabs deleting the same message all settle the same way.
  if (message.deleted_at) {
    return NextResponse.json({ deleted: true, id: message.id, channel_id: message.channel_id });
  }

  const { error: updateError } = await admin
    .from('chat_messages')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: user.id,
      // The body is cleared, not just hidden. A deleted message that still holds
      // its text in the table would come back the moment any future query forgot
      // the `deleted_at is null` filter, and "gone without a trace" has to mean
      // the words are gone too.
      body: null,
      image_path: null,
    })
    .eq('id', id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  // Remove the photo itself. Best effort on purpose: the message is already
  // deleted as far as every reader is concerned, and failing the request over a
  // leftover storage object would tell the owner the delete did not work when it
  // did. An orphaned object in a private bucket is unreachable without a signed
  // URL, which nothing will ask for now that image_path is null.
  if (message.image_path) {
    await admin.storage.from('chat-images').remove([message.image_path]);
  }

  return NextResponse.json({ deleted: true, id: message.id, channel_id: message.channel_id });
}
