'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import AuthenticatedThemeToggleControl from '@/app/components/AuthenticatedThemeToggleControl';
import { useAuthenticatedTheme } from '@/app/components/AuthenticatedThemeProvider';
import { useInAdminShell } from '@/app/components/AdminShellContext';
import {
  channelDisplayName,
  unreadCountByChannel,
  validateChannelName,
  formatMessageTime,
  validateChatImageFile,
  buildChatImagePath,
  replyPreviewText,
  channelDeleteConfirmed,
} from '@/lib/chat';
import { flattenEntityIds, messageMentionsUser, trimBodyWithEntities } from '@/lib/chat-entities';
import EntityComposer from './EntityComposer';
import MessageBody from './MessageBody';

// Every message read is this exact column list. One constant instead of three
// copies: the load, the optimistic insert and the mentions view must agree, and
// silently missing `entities` on one of them would render a message as flat text
// only on that path.
const MESSAGE_SELECT =
  'id, channel_id, sender_id, body, image_path, reply_to_id, created_at, deleted_at, entities, mentioned_user_ids, linked_event_ids';

// Columns needed to render an #event link and its dropdown row. `slug`,
// `status` and `visibility` are what lib/linked-event-link.js needs to decide
// whether a non-admin has any page to open at all.
const EVENT_SELECT = 'id, title, event_date, slug, status, visibility';

// The autocomplete's warm cache: everything upcoming plus this many of the most
// recent past events, fetched once when the page opens. It covers essentially
// every event anyone references in conversation ("is #Mr. Untz locked in" is
// always about the next one), and means the common case costs no request at all.
// Anything older is reachable through the debounced remote search below.
const EVENT_PREFETCH_RECENT = 60;
const EVENT_SEARCH_LIMIT = 20;

// Signed URLs are requested with this TTL (seconds). Chat images live in a
// private bucket, so every render resolves a path to a fresh, short-lived URL
// rather than ever storing/caching a permanent public link.
const CHAT_IMAGE_SIGNED_URL_TTL = 3600;

// Local, page-scoped light/dark palette — mirrors the pattern used by the
// Events Calendar (app/components/EventsCalendarClient.js). Dark values
// are the original hardcoded colors this page always used; light values are
// new. No global theme system involved.
const THEMES = {
  dark: {
    text: '#f5f5f5',
    muted: '#8a8a8a',
    faint: '#555',
    accent: '#ffb84d',
    pageBg: 'transparent',
    panelBg: '#141414',
    inputBg: '#0f0f0f',
    border: 'rgba(255,255,255,0.08)',
    borderStrong: 'rgba(255,255,255,0.15)',
    activeRowBg: 'rgba(255,255,255,0.08)',
    inactiveText: '#bbb',
    bodyText: '#ddd',
    sendBg: '#ffffff',
    sendText: '#0a0a0a',
  },
  light: {
    text: '#1a1a1d',
    muted: '#5c5c63',
    faint: '#9a948a',
    accent: '#8a5109',
    pageBg: 'transparent',
    panelBg: '#ffffff',
    inputBg: '#f5f2ec',
    border: 'rgba(0,0,0,0.12)',
    borderStrong: 'rgba(0,0,0,0.18)',
    activeRowBg: 'rgba(0,0,0,0.06)',
    inactiveText: '#5c5c63',
    bodyText: '#3a3a40',
    sendBg: '#1a1a1d',
    sendText: '#ffffff',
  },
};

// `canModerate` is the owner's account. It reveals the delete affordances on
// every message (including other people's and DMs) and on group channels.
// Hiding them from everyone else is cosmetic only: both API routes re-check the
// caller and the restrictive RLS policies in
// supabase/migrations/20260829_chat_owner_only_moderation.sql refuse a direct
// PostgREST delete no matter what the browser sends.
export default function TeamChatClient({ currentUserId, currentUserName, canCreateChannel, canModerate, isAdmin = false }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { theme, toggleTheme } = useAuthenticatedTheme();
  const t = THEMES[theme];

  const [channels, setChannels] = useState([]);        // chat_channels rows I belong to
  const [roster, setRoster] = useState([]);            // chat_channel_members rows (my channels)
  const [team, setTeam] = useState([]);                // team_members (excluding self)
  const [unreadByChannel, setUnreadByChannel] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  // Entity offsets for the draft, kept alongside the text rather than encoded
  // into it. See lib/chat-entities.js for why the text stays plain.
  const [draftEntities, setDraftEntities] = useState([]);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [composingChannel, setComposingChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [createChannelError, setCreateChannelError] = useState(null);

  // Image attachment + reply-to-message composer state.
  const [pendingImage, setPendingImage] = useState(null); // { file, previewUrl }
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState(null);
  const [replyTo, setReplyTo] = useState(null); // full chat_messages row being replied to
  const [imageUrlByPath, setImageUrlByPath] = useState({}); // image_path -> signed url
  const [flashMessageId, setFlashMessageId] = useState(null);

  // ---- @mentions ----------------------------------------------------------
  // Unread mentions per channel, from public.chat_mention_unread_counts(). A
  // strict subset of unreadByChannel, tracked separately because being named is
  // a different signal from a channel simply being busy — the two render as
  // different markers and must never be added together.
  const [mentionUnreadByChannel, setMentionUnreadByChannel] = useState({});
  // 'thread' shows the selected conversation; 'mentions' shows every message
  // that named the viewer, newest first, across every channel and DM.
  const [view, setView] = useState('thread');
  const [mentionMessages, setMentionMessages] = useState([]);
  const [mentionsLoading, setMentionsLoading] = useState(false);

  // ---- #event linking -----------------------------------------------------
  // One store for both jobs: the pool the '#' autocomplete offers, and the
  // lookup that re-resolves every event a loaded message links. They are the
  // same rows, so keeping two collections would only let them disagree.
  const [eventsById, setEventsById] = useState({});
  const [eventSearchLoading, setEventSearchLoading] = useState(false);

  // Moderation state (owner only).
  // `armedDeleteId` is the two-step guard on a message: the first click on
  // DELETE arms that one message and the second click performs it, so a stray
  // click while reading never destroys a message and no modal has to interrupt
  // the thread. Arming one message disarms any other.
  const [armedDeleteId, setArmedDeleteId] = useState(null);
  const [deletingMessageId, setDeletingMessageId] = useState(null);
  const [moderationError, setModerationError] = useState(null);
  // Channel deletion is heavier: it names the channel awaiting deletion and
  // holds what the owner has typed so far to confirm it.
  const [channelPendingDelete, setChannelPendingDelete] = useState(null); // channel row
  const [channelDeleteText, setChannelDeleteText] = useState('');
  const [channelDeleteError, setChannelDeleteError] = useState(null);
  const [deletingChannel, setDeletingChannel] = useState(false);

  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const knownImagePathsRef = useRef(new Set());

  // A message id to scroll to once the conversation containing it has loaded.
  // Deliberately a ref, not state: it is a one-shot instruction consumed by an
  // effect, and nothing renders differently because of it.
  const pendingScrollRef = useRef(null);
  // A deep link is honoured once per page load. Without this latch, arriving
  // from a notification would re-select that channel every time the sidebar
  // refreshed, yanking the viewer back out of whatever they moved on to.
  const deepLinkAppliedRef = useRef(false);

  // Read by the realtime handler, which must not resubscribe every time the
  // viewer switches conversations.
  const selectedIdRef = useRef(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const teamByUserId = useMemo(() => {
    const m = {};
    for (const t of team) m[t.user_id] = t;
    return m;
  }, [team]);

  // Same map, plus the viewer. `team` deliberately excludes self (it is the DM
  // list), but a message that mentions the viewer has to resolve their own name
  // too — otherwise the one mention that matters most falls back to a stale
  // stored label.
  const usersByUserId = useMemo(
    () => ({ ...teamByUserId, [currentUserId]: { user_id: currentUserId, full_name: currentUserName } }),
    [teamByUserId, currentUserId, currentUserName]
  );

  // Who the '@' autocomplete may offer: teammates who are actually in the open
  // conversation, never the viewer themselves.
  //
  // This is permission-correct by construction rather than by a check — `roster`
  // and `team` are both RLS-limited reads the viewer already had, so the
  // intersection cannot contain anyone they are not allowed to see. It also
  // matches what the database will do: the fan-out trigger intersects mentions
  // with channel membership, so naming someone outside the conversation would
  // notify nobody, and offering them would be a lie.
  const mentionCandidates = useMemo(() => {
    if (!selectedId) return [];
    const inChannel = new Set(
      roster.filter((r) => r.channel_id === selectedId).map((r) => r.user_id)
    );
    return team.filter((m) => m.user_id !== currentUserId && inChannel.has(m.user_id));
  }, [selectedId, roster, team, currentUserId]);

  // Fold newly fetched events into the store, keeping the object identity stable
  // when nothing actually changed — the resolve-missing-events effect below
  // depends on eventsById, so returning a fresh object every time would loop.
  const mergeEvents = useCallback((rows) => {
    if (!rows || rows.length === 0) return;
    setEventsById((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const row of rows) {
        if (!row?.id) continue;
        if (!next[row.id]) changed = true;
        next[row.id] = row;
      }
      return changed ? next : prev;
    });
  }, []);

  const eventOptions = useMemo(() => Object.values(eventsById), [eventsById]);

  // Today as a plain YYYY-MM-DD, matching the date-only `events.event_date`
  // column. Computed once per mount: this only orders the dropdown (upcoming
  // first, then most recent past), so it does not need to tick over midnight,
  // and a stable value keeps the ranking from reshuffling mid-keystroke.
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // For resolving reply_to_id -> the quoted message, out of what's already
  // loaded for the open thread. Deliberately client-side (no denormalized
  // sender/snippet columns) since this page already loads the full,
  // unpaginated message history per channel.
  const messagesById = useMemo(() => {
    const m = {};
    for (const msg of messages) m[msg.id] = msg;
    return m;
  }, [messages]);

  const nameForSender = useCallback((senderId) => {
    if (senderId === currentUserId) return 'You';
    const sender = teamByUserId[senderId];
    return sender?.full_name || sender?.email || 'Someone';
  }, [currentUserId, teamByUserId]);

  // ---- initial load -------------------------------------------------------
  const loadSidebar = useCallback(async () => {
    // Team roster (for DM list + sender-name lookups), excluding myself.
    const { data: teamRows } = await supabase
      .from('team_members')
      // `role` feeds the '@' dropdown's secondary line, which is what tells two
      // teammates with the same display name apart.
      .select('id, user_id, full_name, email, role')
      .neq('user_id', currentUserId)
      .order('full_name', { ascending: true });

    // My channel memberships + rosters of those channels (RLS-limited).
    const { data: memberRows } = await supabase
      .from('chat_channel_members')
      .select('channel_id, user_id, last_read_at');

    const myChannelIds = [
      ...new Set((memberRows || []).filter((r) => r.user_id === currentUserId).map((r) => r.channel_id)),
    ];

    let channelRows = [];
    if (myChannelIds.length > 0) {
      const { data } = await supabase
        .from('chat_channels')
        .select('id, type, name, is_default, created_at')
        .in('id', myChannelIds);
      channelRows = data || [];
    }

    // Unread counts per channel, counted in Postgres against each membership's
    // last_read_at (see the chat_unread_counts migration).
    const { data: unreadRows } = await supabase.rpc('chat_unread_counts');

    // Unread @mentions per channel, from the per-recipient chat_mentions rows.
    // Separate from the read cursor above because a mention stays unread until
    // the viewer actually opens that conversation, independent of how much of
    // the surrounding chatter they have scrolled past.
    const { data: mentionRows } = await supabase.rpc('chat_mention_unread_counts');

    setTeam(teamRows || []);
    setRoster(memberRows || []);
    setChannels(channelRows);
    setUnreadByChannel(unreadCountByChannel(unreadRows));
    setMentionUnreadByChannel(unreadCountByChannel(mentionRows));
    setLoading(false);

    // Default selection: the General/default channel, else first channel.
    setSelectedId((prev) => {
      if (prev) return prev;
      const def = channelRows.find((c) => c.is_default) || channelRows.find((c) => c.type === 'channel') || channelRows[0];
      return def ? def.id : null;
    });
  }, [supabase, currentUserId]);

  useEffect(() => {
    loadSidebar();
  }, [loadSidebar]);

  // ---- mark a channel read -----------------------------------------------
  const markRead = useCallback(async (channelId) => {
    setUnreadByChannel((prev) => (prev[channelId] ? { ...prev, [channelId]: 0 } : prev));
    setMentionUnreadByChannel((prev) => (prev[channelId] ? { ...prev, [channelId]: 0 } : prev));
    await Promise.all([
      supabase
        .from('chat_channel_members')
        .update({ last_read_at: new Date().toISOString() })
        .eq('channel_id', channelId)
        .eq('user_id', currentUserId),
      // Opening the conversation is what clears its mentions: the viewer has now
      // seen the message that named them. Stamped through the RPC rather than a
      // direct update so the caller can only ever touch their own rows' read_at.
      supabase.rpc('chat_mark_mentions_read', { p_channel_id: channelId }),
    ]);
  }, [supabase, currentUserId]);

  // Re-read every unread count from Postgres. Used after a deletion, where the
  // arithmetic in the browser can no longer be trusted: the message that raised
  // a badge may be the one that just disappeared.
  const refreshUnread = useCallback(async () => {
    const [{ data }, { data: mentionRows }] = await Promise.all([
      supabase.rpc('chat_unread_counts'),
      supabase.rpc('chat_mention_unread_counts'),
    ]);
    setUnreadByChannel(unreadCountByChannel(data));
    setMentionUnreadByChannel(unreadCountByChannel(mentionRows));
  }, [supabase]);

  // Drop a channel that no longer exists from every piece of local state, and
  // move off it if it was open. Shared by the owner's own delete and by the
  // realtime DELETE that tells everyone else. Without the re-selection the
  // viewer would be left staring at a thread whose channel is gone, and the
  // composer would post into a dead id.
  const forgetChannel = useCallback((channelId) => {
    setChannels((prev) => prev.filter((c) => c.id !== channelId));
    setRoster((prev) => prev.filter((r) => r.channel_id !== channelId));
    const withoutChannel = (prev) => {
      if (!(channelId in prev)) return prev;
      const next = { ...prev };
      delete next[channelId];
      return next;
    };
    setUnreadByChannel(withoutChannel);
    setMentionUnreadByChannel(withoutChannel);
    // Mentions from a channel that no longer exists have nowhere to jump to.
    setMentionMessages((prev) => prev.filter((m) => m.channel_id !== channelId));
    // Deselecting is enough to clear the thread: the message-loading effect
    // below empties the pane whenever there is no selection.
    setSelectedId((prev) => (prev === channelId ? null : prev));
  }, []);

  // ---- load messages for the selected channel ----------------------------
  useEffect(() => {
    // No selection means no thread — reached on first load and again after the
    // open channel is deleted out from under the viewer.
    if (!selectedId) {
      setMessages([]);
      setReplyTo(null);
      return undefined;
    }
    let active = true;

    (async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select(MESSAGE_SELECT)
        .eq('channel_id', selectedId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (!active) return;
      setMessages(data || []);
      markRead(selectedId);
    })();

    // Switching conversations clears any in-progress reply/attachment draft —
    // it was scoped to the thread being left.
    setReplyTo(null);
    clearPendingImage();
    // The draft's entity offsets index into the draft text, so they have to be
    // cleared together with it. Leaving stale offsets behind would tint the
    // wrong characters of whatever gets typed next.
    setDraft('');
    setDraftEntities([]);

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, supabase, markRead]);

  // ---- prefetch the events the '#' autocomplete offers -------------------
  // One read on open: everything still upcoming, plus a window of recent past
  // events. RLS on public.events decides what comes back — a team member sees
  // every event, so no extra filtering belongs here, and any tightening of that
  // policy later automatically tightens the dropdown with it.
  useEffect(() => {
    let active = true;
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [upcoming, recent] = await Promise.all([
        supabase.from('events').select(EVENT_SELECT).gte('event_date', today).order('event_date', { ascending: true }),
        supabase.from('events').select(EVENT_SELECT).lt('event_date', today).order('event_date', { ascending: false }).limit(EVENT_PREFETCH_RECENT),
      ]);
      if (!active) return;
      mergeEvents([...(upcoming.data || []), ...(recent.data || [])]);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  // ---- resolve every event a loaded message links ------------------------
  // Messages carry linked_event_ids, and rendering re-resolves each one against
  // live data so a renamed event reads correctly in an old message. Anything not
  // already in the prefetched window (an old event referenced in an old message)
  // is fetched here. An id that comes back with no row is left unresolved on
  // purpose — MessageBody then falls back to the label stored at send time.
  useEffect(() => {
    const missing = new Set();
    for (const m of [...messages, ...mentionMessages]) {
      for (const id of m.linked_event_ids || []) {
        if (!eventsById[id]) missing.add(id);
      }
    }
    if (missing.size === 0) return undefined;

    let active = true;
    (async () => {
      const { data } = await supabase.from('events').select(EVENT_SELECT).in('id', [...missing]);
      if (!active || !data) return;
      mergeEvents(data);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, mentionMessages, eventsById, supabase]);

  // ---- resolve image_path -> signed URL for every image message loaded ---
  // The chat-images bucket is private, so a path only becomes viewable via a
  // short-lived signed URL (re-checked against the storage RLS policy on
  // every call). knownImagePathsRef avoids re-requesting a URL we already
  // have without needing imageUrlByPath itself as an effect dependency.
  useEffect(() => {
    const missing = [];
    for (const m of messages) {
      if (m.image_path && !knownImagePathsRef.current.has(m.image_path)) missing.push(m.image_path);
    }
    if (missing.length === 0) return;

    let active = true;
    (async () => {
      const { data } = await supabase.storage.from('chat-images').createSignedUrls(missing, CHAT_IMAGE_SIGNED_URL_TTL);
      if (!active || !data) return;
      setImageUrlByPath((prev) => {
        const next = { ...prev };
        for (const row of data) {
          if (row.signedUrl && row.path) {
            next[row.path] = row.signedUrl;
            knownImagePathsRef.current.add(row.path);
          }
        }
        return next;
      });
    })();

    return () => {
      active = false;
    };
  }, [messages, supabase]);

  // ---- realtime: one subscription across every conversation --------------
  // Unfiltered on purpose. RLS decides which inserts reach this client, so a
  // conversation the viewer is NOT looking at can light up its own unread badge
  // as messages land, instead of only updating on reload.
  useEffect(() => {
    const channel = supabase
      .channel('chat:all')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const msg = payload.new;
          if (msg.deleted_at || msg.sender_id === currentUserId) return;

          const mentionsMe = messageMentionsUser(msg, currentUserId);
          // A mention lands in the Mentions view immediately, whether or not that
          // view is open and whether or not the viewer is looking at the channel
          // it came from — the point of the view is that nothing addressed to you
          // is ever only discoverable by scrolling back through a channel.
          if (mentionsMe) {
            setMentionMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [msg, ...prev]));
          }

          if (msg.channel_id === selectedIdRef.current) {
            setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
            markRead(msg.channel_id);
            return;
          }
          setUnreadByChannel((prev) => ({
            ...prev,
            [msg.channel_id]: (prev[msg.channel_id] || 0) + 1,
          }));
          if (mentionsMe) {
            setMentionUnreadByChannel((prev) => ({
              ...prev,
              [msg.channel_id]: (prev[msg.channel_id] || 0) + 1,
            }));
          }
        }
      )
      // A delete is an UPDATE that sets deleted_at, so without this handler a
      // message the owner removed would stay on every other teammate's screen
      // until they reloaded — the exact window where somebody reads the thing
      // that was just deleted. Only the owner can produce these updates.
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const msg = payload.new;
          if (!msg?.deleted_at) return;
          setMessages((prev) => prev.filter((m) => m.id !== msg.id));
          // Its mention rows are gone too (the migration's delete trigger drops
          // them), so it must leave the Mentions view as well rather than sitting
          // there as a jump target for a message nobody can see any more.
          setMentionMessages((prev) => prev.filter((m) => m.id !== msg.id));
          // A deleted message stops counting as unread, so a badge raised by it
          // has to come down. Re-reading the counts in Postgres is cheaper to
          // get right than guessing which badge to decrement.
          setUnreadByChannel((prev) => (prev[msg.channel_id] ? { ...prev, [msg.channel_id]: 0 } : prev));
          refreshUnread();
        }
      )
      // Channel deletes. Postgres sends only the primary key for a DELETE (the
      // table's replica identity is the default), which is all that is needed to
      // drop the channel from the sidebar. Unlike INSERT/UPDATE, DELETE events
      // are not RLS-filtered — a bare channel id is not information worth
      // withholding, and every client either has that channel or ignores the id.
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'chat_channels' },
        (payload) => {
          const goneId = payload.old?.id;
          if (!goneId) return;
          forgetChannel(goneId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, currentUserId, markRead, refreshUnread, forgetChannel]);

  // Auto-scroll to newest message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ---- open (or create) a DM with a teammate -----------------------------
  const openDm = useCallback(async (otherUserId) => {
    const { data, error } = await supabase.rpc('get_or_create_dm', { other_user_id: otherUserId });
    if (error || !data) return;
    const channelId = typeof data === 'object' ? (data.id || data.channel_id || data) : data;
    // Ensure the new DM shows in the sidebar.
    await loadSidebar();
    setSelectedId(channelId);
  }, [supabase, loadSidebar]);

  // ---- create a channel (owner only) --------------------------------------
  // The button that reaches this is hidden for everyone else, but hiding it is
  // cosmetic: the route re-checks the caller and the restrictive RLS policy
  // blocks a direct PostgREST insert.
  const createChannel = useCallback(async () => {
    if (creatingChannel) return;
    const { valid, name, error } = validateChannelName(newChannelName);
    if (!valid) {
      setCreateChannelError(error);
      return;
    }

    setCreatingChannel(true);
    setCreateChannelError(null);
    const res = await fetch('/api/team/chat/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const payload = await res.json().catch(() => ({}));
    setCreatingChannel(false);

    if (!res.ok) {
      setCreateChannelError(payload.error || 'Could not create the channel.');
      return;
    }

    setNewChannelName('');
    setComposingChannel(false);
    await loadSidebar();
    setSelectedId(payload.channel.id);
  }, [creatingChannel, newChannelName, loadSidebar]);

  // ---- delete a message (owner only) --------------------------------------
  // Reaches every message the owner can see: their own, a teammate's, in a group
  // channel or in a DM. The route does the soft delete server-side; removing the
  // row from local state here is what makes it vanish instantly for the owner,
  // while the realtime UPDATE handler above does the same for everyone else.
  const deleteMessage = useCallback(async (messageId) => {
    if (deletingMessageId) return;
    setDeletingMessageId(messageId);
    setModerationError(null);

    const res = await fetch(`/api/team/chat/messages/${messageId}`, { method: 'DELETE' });
    const payload = await res.json().catch(() => ({}));
    setDeletingMessageId(null);
    setArmedDeleteId(null);

    if (!res.ok) {
      setModerationError(payload.error || 'Could not delete that message.');
      return;
    }

    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    // If the deleted message was the one being replied to, the composer's quote
    // now points at nothing.
    setReplyTo((prev) => (prev?.id === messageId ? null : prev));
    refreshUnread();
  }, [deletingMessageId, refreshUnread]);

  // ---- delete a channel (owner only) --------------------------------------
  // Guarded by typing the channel name; the route enforces the same rule so a
  // hand-made request cannot skip it.
  const deleteChannel = useCallback(async () => {
    if (!channelPendingDelete || deletingChannel) return;
    if (!channelDeleteConfirmed(channelDeleteText, channelPendingDelete.name)) {
      setChannelDeleteError(`Type "${channelPendingDelete.name}" to confirm.`);
      return;
    }

    setDeletingChannel(true);
    setChannelDeleteError(null);
    const res = await fetch(`/api/team/chat/channels/${channelPendingDelete.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: channelDeleteText }),
    });
    const payload = await res.json().catch(() => ({}));
    setDeletingChannel(false);

    if (!res.ok) {
      setChannelDeleteError(payload.error || 'Could not delete that channel.');
      return;
    }

    forgetChannel(channelPendingDelete.id);
    setChannelPendingDelete(null);
    setChannelDeleteText('');
  }, [channelPendingDelete, channelDeleteText, deletingChannel, forgetChannel]);

  // ---- image attachment handling ------------------------------------------
  const clearPendingImage = useCallback(() => {
    setPendingImage((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }, []);

  const handleImageSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file later
    if (!file) return;
    const { valid, error } = validateChatImageFile(file);
    if (!valid) {
      setImageError(error);
      return;
    }
    setImageError(null);
    clearPendingImage();
    setPendingImage({ file, previewUrl: URL.createObjectURL(file) });
  }, [clearPendingImage]);

  // ---- click-to-reply -------------------------------------------------------
  const scrollToMessage = useCallback((messageId) => {
    const el = document.getElementById(`chat-msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashMessageId(messageId);
    setTimeout(() => setFlashMessageId((prev) => (prev === messageId ? null : prev)), 1200);
  }, []);

  const notifyPush = useCallback(async (messageId) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) return;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    await fetch(`${url}/functions/v1/chat-notify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: messageId }),
    });
  }, [supabase]);

  // ---- send a message -----------------------------------------------------
  const sendMessage = useCallback(async () => {
    // Trimming has to carry the entity offsets with it, or every token slides
    // left by however much leading whitespace the draft had.
    const { body, entities: bodyEntities } = trimBodyWithEntities(draft, draftEntities);
    if ((!body && !pendingImage) || !selectedId || sending) return;
    setSending(true);

    let imagePath = null;
    if (pendingImage) {
      setUploadingImage(true);
      const path = buildChatImagePath(selectedId, pendingImage.file.name);
      const { error: uploadError } = await supabase.storage
        .from('chat-images')
        .upload(path, pendingImage.file, { contentType: pendingImage.file.type, upsert: false });
      setUploadingImage(false);
      if (uploadError) {
        setSending(false);
        setImageError('Could not upload the image. Please try again.');
        return;
      }
      imagePath = path;
    }

    const replyToId = replyTo?.id || null;
    setDraft('');
    setDraftEntities([]);
    const draftReplyTo = replyTo;
    const draftPendingImage = pendingImage;
    setReplyTo(null);
    clearPendingImage();

    const { data: inserted, error } = await supabase
      .from('chat_messages')
      .insert({
        channel_id: selectedId,
        sender_id: currentUserId,
        body,
        image_path: imagePath,
        reply_to_id: replyToId,
        entities: bodyEntities,
        // Sent for an instant optimistic render only. The BEFORE INSERT trigger
        // in supabase/migrations/20260831_chat_message_entities_and_mentions.sql
        // recomputes both arrays from `entities` under the sender's own
        // privileges, so whatever the browser claims here is overwritten — a
        // client cannot mention someone it could not see or link an event it
        // could not read.
        ...flattenEntityIds(bodyEntities),
      })
      .select(MESSAGE_SELECT)
      .single();

    setSending(false);

    if (error || !inserted) {
      // Restore the draft so the user doesn't lose their text/reply context.
      // Note: if an image had already uploaded above, it stays in storage even
      // though this message insert failed — a harmless orphaned object with no
      // message referencing it, not a correctness or security issue.
      setDraft(body);
      setDraftEntities(bodyEntities);
      setReplyTo(draftReplyTo);
      if (draftPendingImage) setImageError('The image uploaded, but the message failed to send. Please try sending again.');
      return;
    }

    setMessages((prev) => (prev.some((m) => m.id === inserted.id) ? prev : [...prev, inserted]));
    markRead(selectedId);

    // Fire-and-forget push notification. Never block the UI on this.
    notifyPush(inserted.id).catch(() => {});
  }, [draft, draftEntities, pendingImage, replyTo, selectedId, sending, supabase, currentUserId, markRead, notifyPush, clearPendingImage]);

  const handleComposerChange = useCallback(({ text, entities }) => {
    setDraft(text);
    setDraftEntities(entities);
  }, []);

  // ---- '#' autocomplete: reach past the prefetched window -----------------
  // Called debounced by the composer. The prefetched upcoming + recent window
  // answers nearly every query without a request; this is what finds an event
  // from last spring. Results are merged into the same store, so a hit stays
  // available for the rest of the session.
  const searchEventsRemote = useCallback(async (query) => {
    setEventSearchLoading(true);
    const { data } = await supabase
      .from('events')
      .select(EVENT_SELECT)
      // Escaped so a '%' or '_' typed into an event name is matched literally
      // rather than as a wildcard.
      .ilike('title', `%${query.replace(/[%_\\]/g, '\\$&')}%`)
      .order('event_date', { ascending: false })
      .limit(EVENT_SEARCH_LIMIT);
    setEventSearchLoading(false);
    mergeEvents(data || []);
  }, [supabase, mergeEvents]);

  // ---- the Mentions view ---------------------------------------------------
  // Every message that named the viewer, newest first, across every channel and
  // DM. Read straight off chat_messages rather than joining chat_mentions: the
  // GIN index on mentioned_user_ids makes the contains-me filter cheap, and RLS
  // still confines the rows to channels the viewer belongs to.
  const loadMentions = useCallback(async () => {
    setMentionsLoading(true);
    const { data } = await supabase
      .from('chat_messages')
      .select(MESSAGE_SELECT)
      .contains('mentioned_user_ids', [currentUserId])
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100);
    setMentionMessages(data || []);
    setMentionsLoading(false);
  }, [supabase, currentUserId]);

  const openMentions = useCallback(() => {
    setView('mentions');
    loadMentions();
  }, [loadMentions]);

  // ---- jump to a specific message, in any conversation --------------------
  // Used by the Mentions view and by a push notification's deep link. When the
  // message is in a conversation that isn't open, the channel has to be selected
  // and its history loaded first, so the target id is parked here and the effect
  // below scrolls to it once it actually exists in the DOM.
  const jumpToMessage = useCallback((channelId, messageId) => {
    setView('thread');
    if (!channelId || !messageId) return;
    if (channelId === selectedIdRef.current) {
      scrollToMessage(messageId);
      return;
    }
    pendingScrollRef.current = messageId;
    setSelectedId(channelId);
  }, [scrollToMessage]);

  // Declared after the auto-scroll-to-newest effect on purpose: both fire on the
  // same commit when a thread loads, and effects run in declaration order, so
  // this one lands last and the deliberate jump beats the default scroll.
  useEffect(() => {
    const target = pendingScrollRef.current;
    if (!target) return;
    // Wait for the message to be in the freshly loaded thread.
    if (!messages.some((m) => m.id === target)) return;
    pendingScrollRef.current = null;
    scrollToMessage(target);
  }, [messages, scrollToMessage]);

  // ---- deep link from a push notification ---------------------------------
  // The chat-notify Edge Function sends { channelId, messageId }, and the mobile
  // app opens /team/chat?c=<channelId>&m=<messageId>. Read from
  // window.location rather than useSearchParams so this component needs no
  // Suspense boundary. Applied once, after the sidebar knows which channels the
  // viewer belongs to — a link to a channel they are not in is ignored rather
  // than selecting an id that would load nothing.
  useEffect(() => {
    if (loading || deepLinkAppliedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const channelId = params.get('c');
    const messageId = params.get('m');
    if (!channelId) return;
    deepLinkAppliedRef.current = true;
    if (!channels.some((c) => c.id === channelId)) return;
    if (messageId) {
      jumpToMessage(channelId, messageId);
    } else {
      setSelectedId(channelId);
    }
  }, [loading, channels, jumpToMessage]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/team/login');
  };

  // ---- derived sidebar data ----------------------------------------------
  const groupChannels = useMemo(
    () => channels.filter((c) => c.type === 'channel')
      .sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0)),
    [channels]
  );

  const selectedChannel = channels.find((c) => c.id === selectedId) || null;
  const selectedTitle = selectedChannel
    ? channelDisplayName(selectedChannel, roster, teamByUserId, currentUserId)
    : '';

  // `channelId` is undefined for a teammate with no DM thread yet — 0 unread.
  const unreadFor = (channelId) => unreadByChannel[channelId] || 0;
  const mentionsFor = (channelId) => mentionUnreadByChannel[channelId] || 0;

  const totalMentionUnread = useMemo(
    () => Object.values(mentionUnreadByChannel).reduce((sum, n) => sum + (Number(n) || 0), 0),
    [mentionUnreadByChannel]
  );

  // team_member.user_id -> existing DM channel id (so the DM list can highlight).
  const dmChannelByUser = useMemo(() => {
    const map = {};
    for (const c of channels) {
      if (c.type !== 'dm') continue;
      const other = roster.find((r) => r.channel_id === c.id && r.user_id !== currentUserId);
      if (other) map[other.user_id] = c.id;
    }
    return map;
  }, [channels, roster, currentUserId]);

  // Inside the admin shell the surrounding container, the "Admin" header, the
  // sign-out button and the way back all already exist. Rendering our own would
  // stack two headers and two sign-out buttons on one screen.
  const inShell = useInAdminShell();
  const Frame = inShell ? 'div' : 'main';

  return (
    <Frame
      className={
        inShell
          ? 'transition-colors duration-150'
          : 'max-w-[1400px] mx-auto px-6 py-12 transition-colors duration-150'
      }
      style={inShell ? { color: t.text } : { background: t.pageBg, color: t.text }}
    >
      {/* Header — standalone page only. Every control in it (the way back,
          the theme toggle, sign out) is the shell's job inside the shell,
          and a non-admin team member never sees the shell. */}
      {!inShell && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
          <div>
            {!inShell && (
              <Link href="/team/calendar" className="text-[12px] tracking-[0.1em] hover:underline" style={{ color: t.muted }}>← TEAM</Link>
            )}
            {/* In the shell the sidebar's Chat entry is already lit and the
                channel list below names the room you are in, so a title and a
                "you are Adam Jarrett" line only pushed the conversation down. */}
            {!inShell && (
              <>
                <h1
                  className="font-extrabold -tracking-[0.02em] leading-[1.15] text-[36px] mt-1"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.text }}
                >
                  Team Chat
                </h1>
                <p className="text-[13px] mt-1" style={{ color: t.muted }}>
                  {currentUserName} · channels &amp; direct messages
                </p>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* The shell header already carries the theme toggle next to Log Out.
                Rendered only when this page supplies its own header instead — a
                non-admin team member never sees the shell. */}
            {!inShell && (
              <AuthenticatedThemeToggleControl theme={theme} onToggle={toggleTheme} />
            )}
            {!inShell && (
              <Link
                href="/team/progress"
                className="px-5 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] border transition-colors hover:bg-white/5"
                style={{ borderColor: t.borderStrong, color: t.accent }}
              >
                TASKS
              </Link>
            )}
            {!inShell && (
              <button
                onClick={handleSignOut}
                className="px-4 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] border transition-colors hover:bg-white/5"
                style={{ borderColor: t.borderStrong, color: t.muted }}
              >
                SIGN OUT
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-5 h-[70vh] min-h-[480px]">
        {/* Sidebar */}
        <aside className="w-[260px] flex-shrink-0 rounded-[14px] border overflow-y-auto" style={{ background: t.panelBg, borderColor: t.border }}>
          <div className="p-4">
            {/* Mentions sits above the channel list because it answers the one
                question a staff member opens chat to ask: is anything waiting on
                me. Its count is a subset of the channel badges below, never a
                total of them. */}
            <button
              onClick={() => (view === 'mentions' ? setView('thread') : openMentions())}
              className="w-full mb-4 px-3 py-2 rounded-[10px] flex items-center gap-2 text-[13px] transition-colors"
              style={{
                background: view === 'mentions' ? t.activeRowBg : 'transparent',
                border: `1px solid ${view === 'mentions' ? t.borderStrong : t.border}`,
                color: view === 'mentions' ? t.text : t.inactiveText,
              }}
              aria-pressed={view === 'mentions'}
            >
              <span aria-hidden="true" className="font-bold" style={{ color: t.accent }}>@</span>
              <span className="flex-1 text-left" style={{ fontWeight: totalMentionUnread > 0 ? 700 : 400 }}>Mentions</span>
              {totalMentionUnread > 0 && (
                <span
                  className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold leading-none"
                  style={{ background: t.accent, color: t.panelBg }}
                  aria-label={`${totalMentionUnread} unread mentions`}
                >
                  {totalMentionUnread > 99 ? '99+' : totalMentionUnread}
                </span>
              )}
            </button>

            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-[10px] font-semibold tracking-[0.12em]" style={{ color: t.muted }}>CHANNELS</div>
              {canCreateChannel && (
                <button
                  onClick={() => {
                    setComposingChannel((prev) => !prev);
                    setCreateChannelError(null);
                  }}
                  className="text-[10px] font-semibold tracking-[0.12em] transition-opacity hover:opacity-70"
                  style={{ color: t.accent }}
                  aria-expanded={composingChannel}
                >
                  {composingChannel ? 'CANCEL' : '+ NEW'}
                </button>
              )}
            </div>

            {composingChannel && (
              <div className="mb-3">
                <input
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      createChannel();
                    }
                  }}
                  autoFocus
                  placeholder="channel-name"
                  aria-label="New channel name"
                  className="w-full rounded-[10px] px-3 py-2 text-[13px] outline-none"
                  style={{ background: t.inputBg, border: `1px solid ${t.borderStrong}`, color: t.text }}
                />
                <button
                  onClick={createChannel}
                  disabled={creatingChannel || !newChannelName.trim()}
                  className="w-full mt-2 px-3 py-2 rounded-full text-[11px] font-semibold tracking-[0.14em] transition-opacity disabled:opacity-40"
                  style={{ background: t.sendBg, color: t.sendText }}
                >
                  {creatingChannel ? 'CREATING…' : 'CREATE CHANNEL'}
                </button>
                {createChannelError && (
                  <p className="text-[11px] mt-2" style={{ color: t.accent }}>{createChannelError}</p>
                )}
              </div>
            )}

            <div className="space-y-1">
              {groupChannels.length === 0 && !loading && (
                <p className="text-[12px]" style={{ color: t.faint }}>No channels yet.</p>
              )}
              {groupChannels.map((c) => (
                <div key={c.id}>
                  <SidebarRow
                    active={c.id === selectedId}
                    unreadCount={unreadFor(c.id)}
                    mentionCount={mentionsFor(c.id)}
                    onClick={() => {
                      setView('thread');
                      setSelectedId(c.id);
                    }}
                    label={`# ${channelDisplayName(c, roster, teamByUserId, currentUserId)}`}
                    t={t}
                    onDelete={canModerate ? () => {
                      setChannelPendingDelete(c);
                      setChannelDeleteText('');
                      setChannelDeleteError(null);
                    } : null}
                  />

                  {/* Confirmation lives inline under the row it will destroy, so
                      the channel being deleted is never in doubt. */}
                  {channelPendingDelete?.id === c.id && (
                    <div
                      className="mt-1 mb-2 rounded-[10px] p-2.5"
                      style={{ background: t.inputBg, border: `1px solid ${t.borderStrong}` }}
                    >
                      <p className="text-[11px] leading-snug" style={{ color: t.muted }}>
                        Deletes <span style={{ color: t.text, fontWeight: 600 }}>#{c.name}</span> and every
                        message in it, for everyone. Type the name to confirm.
                      </p>
                      <input
                        value={channelDeleteText}
                        onChange={(e) => setChannelDeleteText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            deleteChannel();
                          }
                          if (e.key === 'Escape') setChannelPendingDelete(null);
                        }}
                        autoFocus
                        placeholder={c.name}
                        aria-label={`Type ${c.name} to confirm deleting the channel`}
                        className="w-full mt-2 rounded-[8px] px-2.5 py-1.5 text-[12px] outline-none"
                        style={{ background: t.panelBg, border: `1px solid ${t.borderStrong}`, color: t.text }}
                      />
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={deleteChannel}
                          disabled={deletingChannel || !channelDeleteConfirmed(channelDeleteText, c.name)}
                          className="flex-1 px-2 py-1.5 rounded-full text-[10px] font-semibold tracking-[0.12em] transition-opacity disabled:opacity-40"
                          style={{ background: t.sendBg, color: t.sendText }}
                        >
                          {deletingChannel ? 'DELETING…' : 'DELETE'}
                        </button>
                        <button
                          onClick={() => setChannelPendingDelete(null)}
                          className="px-2 py-1.5 text-[10px] font-semibold tracking-[0.12em]"
                          style={{ color: t.muted }}
                        >
                          CANCEL
                        </button>
                      </div>
                      {channelDeleteError && (
                        <p className="text-[11px] mt-2" style={{ color: t.accent }}>{channelDeleteError}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="text-[10px] font-semibold tracking-[0.12em] mt-6 mb-2" style={{ color: t.muted }}>DIRECT MESSAGES</div>
            <div className="space-y-1">
              {team.length === 0 && !loading && (
                <p className="text-[12px]" style={{ color: t.faint }}>No teammates found.</p>
              )}
              {team.map((member) => {
                const dmId = dmChannelByUser[member.user_id];
                return (
                  <SidebarRow
                    key={member.user_id}
                    active={dmId != null && dmId === selectedId}
                    unreadCount={unreadFor(dmId)}
                    mentionCount={mentionsFor(dmId)}
                    onClick={() => {
                      setView('thread');
                      if (dmId) setSelectedId(dmId);
                      else openDm(member.user_id);
                    }}
                    label={member.full_name || member.email}
                    t={t}
                  />
                );
              })}
            </div>
          </div>
        </aside>

        {/* Thread */}
        <section className="flex-1 min-w-0 flex flex-col rounded-[14px] border" style={{ background: t.panelBg, borderColor: t.border }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: t.border }}>
            <h2 className="text-[16px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.text }}>
              {view === 'mentions'
                ? 'Mentions'
                : selectedChannel
                  ? (selectedChannel.type === 'dm' ? selectedTitle : `# ${selectedTitle}`)
                  : 'Select a conversation'}
            </h2>
            {view === 'mentions' && (
              <p className="text-[12px] mt-0.5" style={{ color: t.muted }}>
                Every message that named you, newest first.
              </p>
            )}
          </div>

          {/* Mentions view. A flat, cross-conversation list — the whole point is
              that being named is never something you have to go looking for,
              channel by channel. Each row jumps to the message in context. */}
          {view === 'mentions' && (
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
              {mentionsLoading && mentionMessages.length === 0 && (
                <p className="text-[13px]" style={{ color: t.faint }}>Loading mentions…</p>
              )}
              {!mentionsLoading && mentionMessages.length === 0 && (
                <p className="text-[13px]" style={{ color: t.faint }}>
                  No one has mentioned you yet. When a teammate types @ and your name, it shows up here.
                </p>
              )}
              {mentionMessages.map((m) => {
                const channel = channels.find((c) => c.id === m.channel_id) || null;
                const where = channel
                  ? (channel.type === 'dm'
                      ? `DM · ${channelDisplayName(channel, roster, teamByUserId, currentUserId)}`
                      : `# ${channelDisplayName(channel, roster, teamByUserId, currentUserId)}`)
                  // A mention whose channel isn't in the sidebar (just deleted,
                  // or membership removed) still lists rather than vanishing.
                  : 'Conversation unavailable';
                const unread = mentionsFor(m.channel_id) > 0;

                return (
                  <button
                    key={m.id}
                    onClick={() => jumpToMessage(m.channel_id, m.id)}
                    disabled={!channel}
                    className="w-full text-left rounded-[10px] p-3 border transition-colors disabled:opacity-60 disabled:cursor-default"
                    style={{
                      background: unread ? t.activeRowBg : t.inputBg,
                      borderColor: unread ? t.accent : t.border,
                    }}
                  >
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-[11px] font-semibold tracking-[0.06em]" style={{ color: t.accent }}>{where}</span>
                      <span className="text-[13px] font-bold" style={{ color: t.text }}>{nameForSender(m.sender_id)}</span>
                      <span className="text-[10px]" style={{ color: t.faint }}>{formatMessageTime(m.created_at)}</span>
                    </div>
                    <MessageBody
                      bodyText={m.body}
                      entities={m.entities}
                      eventsById={eventsById}
                      usersByUserId={usersByUserId}
                      isAdmin={isAdmin}
                      currentUserId={currentUserId}
                      t={t}
                    />
                    {channel && (
                      <span className="mt-1 inline-block text-[10px] font-semibold tracking-[0.08em]" style={{ color: t.muted }}>
                        JUMP TO MESSAGE →
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {view === 'thread' && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {!selectedId && (
              <p className="text-[13px]" style={{ color: t.faint }}>Pick a channel or teammate to start chatting.</p>
            )}
            {selectedId && messages.length === 0 && (
              <p className="text-[13px]" style={{ color: t.faint }}>No messages yet. Say hello.</p>
            )}
            {messages.map((m) => {
              const mine = m.sender_id === currentUserId;
              const name = nameForSender(m.sender_id);
              const quoted = m.reply_to_id ? messagesById[m.reply_to_id] : null;
              const quotedPreview = m.reply_to_id ? replyPreviewText(quoted) : null;
              const imageUrl = m.image_path ? imageUrlByPath[m.image_path] : null;
              // A message that named the viewer keeps a standing marker — an
              // accent rail down its left edge — rather than only a transient
              // notification. Scrolling a busy channel, the thing addressed to you
              // stays findable after the badge has been cleared.
              const mentionsMe = messageMentionsUser(m, currentUserId);
              return (
                <div
                  key={m.id}
                  id={`chat-msg-${m.id}`}
                  className="flex flex-col group rounded-[8px] transition-colors duration-500 -mx-2 px-2"
                  style={{
                    background: flashMessageId === m.id
                      ? t.activeRowBg
                      : mentionsMe
                        ? `color-mix(in srgb, ${t.accent} 8%, transparent)`
                        : 'transparent',
                    borderLeft: mentionsMe ? `2px solid ${t.accent}` : '2px solid transparent',
                  }}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-bold" style={{ color: mine ? t.accent : t.text }}>{name}</span>
                    <span className="text-[10px]" style={{ color: t.faint }}>{formatMessageTime(m.created_at)}</span>
                    {mentionsMe && (
                      <span
                        className="text-[9px] font-bold tracking-[0.1em] px-1.5 py-0.5 rounded-full"
                        style={{ background: t.accent, color: t.panelBg }}
                      >
                        MENTIONED YOU
                      </span>
                    )}
                    <button
                      onClick={() => setReplyTo(m)}
                      className="text-[10px] font-semibold tracking-[0.08em] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity ml-1"
                      style={{ color: t.muted }}
                      aria-label="Reply to this message"
                      title="Reply"
                    >
                      ↩ REPLY
                    </button>
                    {canModerate && (
                      <button
                        onClick={() => {
                          if (armedDeleteId === m.id) {
                            deleteMessage(m.id);
                            return;
                          }
                          setArmedDeleteId(m.id);
                          setModerationError(null);
                        }}
                        onBlur={() => setArmedDeleteId((prev) => (prev === m.id ? null : prev))}
                        disabled={deletingMessageId === m.id}
                        className={`text-[10px] font-semibold tracking-[0.08em] transition-opacity ${
                          armedDeleteId === m.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                        }`}
                        style={{ color: armedDeleteId === m.id ? t.accent : t.muted }}
                        aria-label={armedDeleteId === m.id ? 'Confirm deleting this message' : 'Delete this message'}
                        title={armedDeleteId === m.id ? 'Click again to delete' : 'Delete'}
                      >
                        {deletingMessageId === m.id
                          ? 'DELETING…'
                          : armedDeleteId === m.id
                            ? 'CONFIRM DELETE'
                            : '✕ DELETE'}
                      </button>
                    )}
                  </div>
                  {m.reply_to_id && (
                    <button
                      onClick={() => scrollToMessage(m.reply_to_id)}
                      className="mt-1 self-start max-w-[85%] text-left rounded-[8px] px-2.5 py-1.5 text-[12px] border-l-2 truncate"
                      style={{ borderColor: t.accent, background: t.inputBg, color: t.muted }}
                    >
                      {quotedPreview != null ? (
                        <>
                          <span className="font-semibold" style={{ color: t.text }}>{nameForSender(quoted?.sender_id)}</span>
                          {' '}{quotedPreview}
                        </>
                      ) : (
                        <span style={{ color: t.faint, fontStyle: 'italic' }}>Original message unavailable</span>
                      )}
                    </button>
                  )}
                  {m.image_path && (
                    imageUrl ? (
                      <a href={imageUrl} target="_blank" rel="noreferrer noopener" className="mt-1.5 inline-block">
                        <img
                          src={imageUrl}
                          alt="Shared attachment"
                          className="max-w-[280px] max-h-[280px] rounded-[10px] border object-cover"
                          style={{ borderColor: t.border }}
                        />
                      </a>
                    ) : (
                      <div
                        className="mt-1.5 w-[160px] h-[100px] rounded-[10px] flex items-center justify-center text-[11px]"
                        style={{ background: t.inputBg, color: t.faint }}
                      >
                        Loading photo…
                      </div>
                    )
                  )}
                  {m.body && (
                    <MessageBody
                      bodyText={m.body}
                      entities={m.entities}
                      eventsById={eventsById}
                      usersByUserId={usersByUserId}
                      isAdmin={isAdmin}
                      currentUserId={currentUserId}
                      t={t}
                    />
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
          )}

          {moderationError && (
            <p className="px-5 pb-2 text-[11px]" style={{ color: t.accent }}>{moderationError}</p>
          )}

          {/* Composer. Hidden in the Mentions view, which is a read-only index
              — you reply by jumping to the message in its conversation. */}
          {selectedId && view === 'thread' && (
            <div className="border-t" style={{ borderColor: t.border }}>
              {replyTo && (
                <div className="px-4 pt-3 flex items-center justify-between gap-2 text-[12px]">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="font-semibold flex-shrink-0" style={{ color: t.accent }}>Replying to {nameForSender(replyTo.sender_id)}</span>
                    <span className="truncate" style={{ color: t.faint }}>{replyPreviewText(replyTo) || ''}</span>
                  </div>
                  <button
                    onClick={() => setReplyTo(null)}
                    className="flex-shrink-0 text-[13px] leading-none"
                    style={{ color: t.faint }}
                    aria-label="Cancel reply"
                  >
                    ✕
                  </button>
                </div>
              )}

              {pendingImage && (
                <div className="px-4 pt-3 flex items-center gap-2">
                  <img
                    src={pendingImage.previewUrl}
                    alt="Selected attachment preview"
                    className="w-14 h-14 rounded-[8px] object-cover border"
                    style={{ borderColor: t.border }}
                  />
                  <button
                    onClick={clearPendingImage}
                    className="text-[12px]"
                    style={{ color: t.faint }}
                    aria-label="Remove selected image"
                  >
                    Remove
                  </button>
                </div>
              )}

              {imageError && (
                <p className="px-4 pt-2 text-[11px]" style={{ color: t.accent }}>{imageError}</p>
              )}

              <div className="px-4 py-3 flex items-end gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={handleImageSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingImage}
                  className="px-4 py-3 rounded-full text-[16px] leading-none border transition-colors disabled:opacity-40"
                  style={{ borderColor: t.borderStrong, color: t.muted }}
                  aria-label="Attach an image"
                  title="Attach an image"
                >
                  📎
                </button>
                <EntityComposer
                  value={draft}
                  entities={draftEntities}
                  onChange={handleComposerChange}
                  onSubmit={sendMessage}
                  userCandidates={mentionCandidates}
                  eventCandidates={eventOptions}
                  onEventSearch={searchEventsRemote}
                  eventSearchLoading={eventSearchLoading}
                  todayIso={todayIso}
                  t={t}
                  disabled={sending || uploadingImage}
                  placeholder="Type a message… @ to mention, # to link an event"
                />
                <button
                  onClick={sendMessage}
                  disabled={sending || uploadingImage || (!draft.trim() && !pendingImage)}
                  className="px-6 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0"
                  style={{ background: t.sendBg, color: t.sendText }}
                >
                  {uploadingImage ? 'UPLOADING…' : sending ? 'SENDING…' : 'SEND'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </Frame>
  );
}

// `onDelete` is optional and only ever supplied for the owner on a group
// channel. The row is a wrapper rather than one big button because a delete
// control nested inside the row's own button would be invalid markup and would
// fire the row's click along with its own.
function SidebarRow({ active, unreadCount, onClick, label, t, onDelete = null, mentionCount = 0 }) {
  const unread = unreadCount > 0;
  // A mention marker rather than a second number: the unread badge already says
  // how much is waiting, and this says that some of it names you. Two competing
  // counts on one row would read as arithmetic that doesn't add up, since
  // mentions are a subset of unread.
  const mentioned = mentionCount > 0;
  return (
    <div
      className="group flex items-center rounded-[10px] transition-colors"
      style={{ background: active ? t.activeRowBg : 'transparent' }}
    >
      <button
        onClick={onClick}
        className="min-w-0 flex-1 text-left pl-3 pr-1 py-2 text-[13px] flex items-center gap-2"
        style={{ color: active ? t.text : t.inactiveText }}
      >
        <span className="truncate flex-1" style={{ fontWeight: unread ? 700 : 400, color: unread && !active ? t.text : undefined }}>{label}</span>
        {mentioned && (
          <span
            className="text-[12px] font-bold leading-none flex-shrink-0"
            style={{ color: t.accent }}
            aria-label={`${mentionCount} mentioning you`}
            title={`${mentionCount} message${mentionCount === 1 ? '' : 's'} mentioning you`}
          >
            @
          </span>
        )}
        {unread && (
          <span
            className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold leading-none flex-shrink-0"
            style={{ background: t.accent, color: t.panelBg }}
            aria-label={`${unreadCount} unread`}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {onDelete && (
        <button
          onClick={onDelete}
          className="flex-shrink-0 px-2.5 py-2 text-[12px] leading-none opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          style={{ color: t.muted }}
          aria-label={`Delete ${label}`}
          title="Delete channel"
        >
          ✕
        </button>
      )}
    </div>
  );
}
