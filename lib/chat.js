// Pure helpers for Team Chat. No I/O, no secrets — safe to import anywhere and
// fully unit-testable. Security lives in Supabase RLS + table grants, NOT here;
// these functions only classify rows the caller already had permission to read.

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

// Reduce the rows returned by the public.chat_unread_counts() RPC into a
// { channelId: count } map. Channels with nothing unread are omitted so
// callers can treat a missing key as "read".
export function unreadCountByChannel(rows) {
  const out = {};
  for (const r of rows || []) {
    const n = Number(r.unread_count) || 0;
    if (n > 0) out[r.channel_id] = n;
  }
  return out;
}

// Total unread across every channel and DM — what the nav badge shows.
export function totalUnreadCount(rows) {
  return (rows || []).reduce((sum, r) => sum + (Number(r.unread_count) || 0), 0);
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

// ---------------------------------------------------------------------------
// Channel creation gate
// ---------------------------------------------------------------------------
//
// Creating a channel is reserved for the owner's account, so the channel list
// stays a deliberate structure rather than something anyone can fragment.
//
// This is an owner-style gate, not a role-wide one: it requires BOTH the
// existing team_members.role = 'admin' AND that the account is the owner's.
// Both of the owner's addresses are listed — lib/auth-helpers.js OWNER_EMAIL
// and public.is_owner() use adam@sdgatx.com, while the admin@sdgatx.com login
// is the one that administers Team Chat. A non-owner admin is NOT permitted.
//
// This helper is advisory (it drives the UI and the API route's 401). The hard
// stop is the restrictive RLS policy in
// supabase/migrations/20260802_team_chat_channel_admin_and_unread.sql, which a
// direct PostgREST call cannot get around.
export const CHAT_CHANNEL_ADMIN_EMAILS = ['admin@sdgatx.com', 'adam@sdgatx.com'];

export function canCreateChatChannel({ role, email } = {}) {
  if (role !== 'admin') return false;
  return CHAT_CHANNEL_ADMIN_EMAILS.includes(String(email || '').trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Channel name validation
// ---------------------------------------------------------------------------

export const CHANNEL_NAME_MAX_LENGTH = 40;

// Normalizes a user-typed channel name into the Slack-ish form the sidebar
// renders after its `#` prefix: lowercase, hyphen-separated, no punctuation.
// Returns { valid, name, error } so the API route and the UI agree on both the
// rule and the message.
export function validateChannelName(raw) {
  const name = String(raw ?? '')
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (name.length < 2) {
    return { valid: false, name: '', error: 'Channel name must be at least 2 characters.' };
  }
  if (name.length > CHANNEL_NAME_MAX_LENGTH) {
    return {
      valid: false,
      name: '',
      error: `Channel name must be ${CHANNEL_NAME_MAX_LENGTH} characters or fewer.`,
    };
  }
  return { valid: true, name, error: null };
}
