import { NextResponse } from 'next/server';
import { requireChatChannelAdmin } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { channelDeleteConfirmed } from '@/lib/chat';

export const runtime = 'nodejs';

// DELETE /api/team/chat/channels/[id] — delete a group channel outright, taking
// its whole message history with it. Owner-only; see requireChatChannelAdmin().
//
// Unlike a message, this is a hard delete. chat_messages.channel_id and
// chat_channel_members.channel_id are both ON DELETE CASCADE, so removing the
// one channel row clears its messages and its roster in a single statement —
// there is no half-deleted state to render, and no "channel with nothing in it"
// for the sidebar to keep showing.
//
// The caller must send { confirm: "<channel name>" }. A channel delete is
// unrecoverable and the button lives next to the channel the owner is reading,
// so the name has to be typed back. channelDeleteConfirmed() lives in lib/chat.js
// so this route and the sidebar apply the identical rule.
//
// DMs are refused. A DM is a two-person thread and deleting the row would erase
// the other person's copy of a private conversation as a side effect of a
// sidebar click; the owner deletes DM content message by message instead, which
// is already unrestricted for them. get_or_create_dm would also just recreate
// the thread on the next message, so the delete would not even stick.
export async function DELETE(request, { params }) {
  const { unauthorized } = await requireChatChannelAdmin();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing channel id' }, { status: 400 });

  const body = await request.json().catch(() => ({}));

  const admin = createAdminClient();

  const { data: channel, error: lookupError } = await admin
    .from('chat_channels')
    .select('id, type, name')
    .eq('id', id)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 400 });
  }
  if (!channel) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
  }
  if (channel.type !== 'channel') {
    return NextResponse.json(
      { error: 'Direct messages cannot be deleted as a thread. Delete the messages instead.' },
      { status: 400 }
    );
  }
  if (!channelDeleteConfirmed(body?.confirm, channel.name)) {
    return NextResponse.json(
      { error: `Type "${channel.name}" exactly to confirm.` },
      { status: 400 }
    );
  }

  // Clear the channel's photos first. Storage objects have no foreign key to the
  // channel, so nothing cascades them — if the row went first, every attachment
  // in the channel's folder would be stranded in the bucket with no record left
  // that could ever name it.
  const { data: objects } = await admin.storage.from('chat-images').list(channel.id, { limit: 1000 });
  if (objects?.length) {
    await admin.storage
      .from('chat-images')
      .remove(objects.map((o) => `${channel.id}/${o.name}`));
  }

  const { error: deleteError } = await admin.from('chat_channels').delete().eq('id', channel.id);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  return NextResponse.json({ deleted: true, id: channel.id, name: channel.name });
}
