// Pure helpers for Team Chat. No I/O, no secrets — safe to import anywhere and
// fully unit-testable. Security lives in Supabase RLS, NOT here; these functions
// only classify rows the caller already had permission to read.

// Display name for a channel row. Group channels use their `name`; DMs have no
// name, so we resolve the counterpart team member's name from the roster.
export function channelDisplayName(channel, roster, teamByUserId, currentUserId) {
  if (channel.type !== 'dm') {
    return channel.name || 'Channel';
  }
  const other = (roster || []).find(
    (m) => m.channel_id === channel.id && m.user_id !== currentUserId
  );
  if (!other) return 'Direct Message';
  const tm = teamByUserId?.[other.user_id];
  return tm?.full_name || tm?.email || 'Direct Message';
}

// Whether a channel has messages the current user hasn't read yet. A user's own
// most-recent message never counts as unread. Missing last_read_at means every
// message from someone else is unread.
export function channelHasUnread(lastMessage, lastReadAt, currentUserId) {
  if (!lastMessage || !lastMessage.created_at) return false;
  if (lastMessage.sender_id === currentUserId) return false;
  if (!lastReadAt) return true;
  return new Date(lastMessage.created_at).getTime() > new Date(lastReadAt).getTime();
}

// Reduce a flat list of messages into a { channelId: {created_at, sender_id} }
// map holding the most-recent message per channel.
export function lastMessagePerChannel(messages) {
  const out = {};
  for (const m of messages || []) {
    const cur = out[m.channel_id];
    if (!cur || new Date(m.created_at).getTime() > new Date(cur.created_at).getTime()) {
      out[m.channel_id] = { created_at: m.created_at, sender_id: m.sender_id };
    }
  }
  return out;
}

// Format an ISO timestamp for display next to a message.
export function formatMessageTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
