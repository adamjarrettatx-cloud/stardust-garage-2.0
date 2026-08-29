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
} from '@/lib/chat';

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

export default function TeamChatClient({ currentUserId, currentUserName, canCreateChannel }) {
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

  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const knownImagePathsRef = useRef(new Set());

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
      .select('id, user_id, full_name, email')
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

    setTeam(teamRows || []);
    setRoster(memberRows || []);
    setChannels(channelRows);
    setUnreadByChannel(unreadCountByChannel(unreadRows));
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
    await supabase
      .from('chat_channel_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('channel_id', channelId)
      .eq('user_id', currentUserId);
  }, [supabase, currentUserId]);

  // ---- load messages for the selected channel ----------------------------
  useEffect(() => {
    if (!selectedId) return;
    let active = true;

    (async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('id, channel_id, sender_id, body, image_path, reply_to_id, created_at, deleted_at')
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

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, supabase, markRead]);

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

          if (msg.channel_id === selectedIdRef.current) {
            setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
            markRead(msg.channel_id);
            return;
          }
          setUnreadByChannel((prev) => ({
            ...prev,
            [msg.channel_id]: (prev[msg.channel_id] || 0) + 1,
          }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, currentUserId, markRead]);

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
    const body = draft.trim();
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
    const draftReplyTo = replyTo;
    const draftPendingImage = pendingImage;
    setReplyTo(null);
    clearPendingImage();

    const { data: inserted, error } = await supabase
      .from('chat_messages')
      .insert({ channel_id: selectedId, sender_id: currentUserId, body, image_path: imagePath, reply_to_id: replyToId })
      .select('id, channel_id, sender_id, body, image_path, reply_to_id, created_at, deleted_at')
      .single();

    setSending(false);

    if (error || !inserted) {
      // Restore the draft so the user doesn't lose their text/reply context.
      // Note: if an image had already uploaded above, it stays in storage even
      // though this message insert failed — a harmless orphaned object with no
      // message referencing it, not a correctness or security issue.
      setDraft(body);
      setReplyTo(draftReplyTo);
      if (draftPendingImage) setImageError('The image uploaded, but the message failed to send. Please try sending again.');
      return;
    }

    setMessages((prev) => (prev.some((m) => m.id === inserted.id) ? prev : [...prev, inserted]));
    markRead(selectedId);

    // Fire-and-forget push notification. Never block the UI on this.
    notifyPush(inserted.id).catch(() => {});
  }, [draft, pendingImage, replyTo, selectedId, sending, supabase, currentUserId, markRead, notifyPush, clearPendingImage]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

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
                <SidebarRow
                  key={c.id}
                  active={c.id === selectedId}
                  unreadCount={unreadFor(c.id)}
                  onClick={() => setSelectedId(c.id)}
                  label={`# ${channelDisplayName(c, roster, teamByUserId, currentUserId)}`}
                  t={t}
                />
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
                    onClick={() => (dmId ? setSelectedId(dmId) : openDm(member.user_id))}
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
              {selectedChannel ? (selectedChannel.type === 'dm' ? selectedTitle : `# ${selectedTitle}`) : 'Select a conversation'}
            </h2>
          </div>

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
              return (
                <div
                  key={m.id}
                  id={`chat-msg-${m.id}`}
                  className="flex flex-col group rounded-[8px] transition-colors duration-500 -mx-2 px-2"
                  style={{ background: flashMessageId === m.id ? t.activeRowBg : 'transparent' }}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-bold" style={{ color: mine ? t.accent : t.text }}>{name}</span>
                    <span className="text-[10px]" style={{ color: t.faint }}>{formatMessageTime(m.created_at)}</span>
                    <button
                      onClick={() => setReplyTo(m)}
                      className="text-[10px] font-semibold tracking-[0.08em] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity ml-1"
                      style={{ color: t.muted }}
                      aria-label="Reply to this message"
                      title="Reply"
                    >
                      ↩ REPLY
                    </button>
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
                    <div className="text-[14px] whitespace-pre-wrap break-words mt-0.5" style={{ color: t.bodyText }}>{m.body}</div>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Composer */}
          {selectedId && (
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
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
                  className="flex-1 resize-none rounded-[12px] px-4 py-3 text-[14px] outline-none"
                  style={{ background: t.inputBg, border: `1px solid ${t.borderStrong}`, color: t.text, maxHeight: '120px' }}
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

function SidebarRow({ active, unreadCount, onClick, label, t }) {
  const unread = unreadCount > 0;
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 rounded-[10px] text-[13px] flex items-center gap-2 transition-colors"
      style={{
        background: active ? t.activeRowBg : 'transparent',
        color: active ? t.text : t.inactiveText,
      }}
    >
      <span className="truncate flex-1" style={{ fontWeight: unread ? 700 : 400, color: unread && !active ? t.text : undefined }}>{label}</span>
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
  );
}
