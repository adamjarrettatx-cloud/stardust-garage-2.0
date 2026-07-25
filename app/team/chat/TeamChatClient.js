'use client';

import { useState, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import ThemeToggle from '@/app/components/ThemeToggle';
import { useAuthenticatedTheme } from '@/app/components/AuthenticatedThemeProvider';
import {
  channelDisplayName,
  channelHasUnread,
  lastMessagePerChannel,
  formatMessageTime,
} from '@/lib/chat';

// Local, page-scoped light/dark palette — mirrors the pattern used by the
// admin Team Calendar (app/bananas/calendar/CalendarClient.js). Dark values
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
    pageBg: '#f2efe8',
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

export default function TeamChatClient({ currentUserId, currentUserName }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { theme, toggleTheme } = useAuthenticatedTheme();
  const t = THEMES[theme];

  const [channels, setChannels] = useState([]);        // chat_channels rows I belong to
  const [roster, setRoster] = useState([]);            // chat_channel_members rows (my channels)
  const [team, setTeam] = useState([]);                // team_members (excluding self)
  const [lastMsgByChannel, setLastMsgByChannel] = useState({});
  const [lastReadByChannel, setLastReadByChannel] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  const bottomRef = useRef(null);

  const teamByUserId = useMemo(() => {
    const m = {};
    for (const t of team) m[t.user_id] = t;
    return m;
  }, [team]);

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

    // Most-recent message per channel, for unread badges.
    let lastMsgs = {};
    if (myChannelIds.length > 0) {
      const { data: msgRows } = await supabase
        .from('chat_messages')
        .select('channel_id, sender_id, created_at')
        .in('channel_id', myChannelIds)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      lastMsgs = lastMessagePerChannel(msgRows || []);
    }

    const reads = {};
    for (const r of memberRows || []) {
      if (r.user_id === currentUserId) reads[r.channel_id] = r.last_read_at;
    }

    setTeam(teamRows || []);
    setRoster(memberRows || []);
    setChannels(channelRows);
    setLastMsgByChannel(lastMsgs);
    setLastReadByChannel(reads);
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
    const now = new Date().toISOString();
    setLastReadByChannel((prev) => ({ ...prev, [channelId]: now }));
    await supabase
      .from('chat_channel_members')
      .update({ last_read_at: now })
      .eq('channel_id', channelId)
      .eq('user_id', currentUserId);
  }, [supabase, currentUserId]);

  // ---- load messages for the selected channel + subscribe realtime -------
  useEffect(() => {
    if (!selectedId) return;
    let active = true;

    (async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('id, channel_id, sender_id, body, created_at, deleted_at')
        .eq('channel_id', selectedId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (!active) return;
      setMessages(data || []);
      markRead(selectedId);
    })();

    const channel = supabase
      .channel(`chat:${selectedId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `channel_id=eq.${selectedId}` },
        (payload) => {
          const msg = payload.new;
          if (msg.deleted_at) return;
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
          setLastMsgByChannel((prev) => ({
            ...prev,
            [msg.channel_id]: { created_at: msg.created_at, sender_id: msg.sender_id },
          }));
          // If the viewer is looking at this channel, keep it marked read.
          if (msg.sender_id !== currentUserId) markRead(selectedId);
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [selectedId, supabase, currentUserId, markRead]);

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
    if (!body || !selectedId || sending) return;
    setSending(true);
    setDraft('');

    const { data: inserted, error } = await supabase
      .from('chat_messages')
      .insert({ channel_id: selectedId, sender_id: currentUserId, body })
      .select('id, channel_id, sender_id, body, created_at, deleted_at')
      .single();

    setSending(false);

    if (error || !inserted) {
      setDraft(body); // restore so the user doesn't lose their text
      return;
    }

    setMessages((prev) => (prev.some((m) => m.id === inserted.id) ? prev : [...prev, inserted]));
    setLastMsgByChannel((prev) => ({
      ...prev,
      [inserted.channel_id]: { created_at: inserted.created_at, sender_id: inserted.sender_id },
    }));
    markRead(selectedId);

    // Fire-and-forget push notification. Never block the UI on this.
    notifyPush(inserted.id).catch(() => {});
  }, [draft, selectedId, sending, supabase, currentUserId, markRead, notifyPush]);

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

  const isUnread = useCallback(
    (channelId) => channelHasUnread(lastMsgByChannel[channelId], lastReadByChannel[channelId], currentUserId),
    [lastMsgByChannel, lastReadByChannel, currentUserId]
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

  return (
    <main
      className="max-w-[1400px] mx-auto px-6 py-12 transition-colors duration-150"
      style={{ background: t.pageBg, color: t.text }}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <div>
          <Link href="/team/calendar" className="text-[12px] tracking-[0.1em] hover:underline" style={{ color: t.muted }}>← TEAM</Link>
          <h1 className="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1] mt-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.text }}>
            Team Chat
          </h1>
          <p className="text-[13px] mt-1" style={{ color: t.muted }}>
            {currentUserName} · channels &amp; direct messages
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <Link
            href="/team/progress"
            className="px-5 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] border transition-colors hover:bg-white/5"
            style={{ borderColor: t.borderStrong, color: t.accent }}
          >
            PROGRESS
          </Link>
          <button
            onClick={handleSignOut}
            className="px-4 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] border transition-colors hover:bg-white/5"
            style={{ borderColor: t.borderStrong, color: t.muted }}
          >
            SIGN OUT
          </button>
        </div>
      </div>

      <div className="flex gap-5 h-[70vh] min-h-[480px]">
        {/* Sidebar */}
        <aside className="w-[260px] flex-shrink-0 rounded-[14px] border overflow-y-auto" style={{ background: t.panelBg, borderColor: t.border }}>
          <div className="p-4">
            <div className="text-[10px] font-semibold tracking-[0.12em] mb-2" style={{ color: t.muted }}>CHANNELS</div>
            <div className="space-y-1">
              {groupChannels.length === 0 && !loading && (
                <p className="text-[12px]" style={{ color: t.faint }}>No channels yet.</p>
              )}
              {groupChannels.map((c) => (
                <SidebarRow
                  key={c.id}
                  active={c.id === selectedId}
                  unread={isUnread(c.id)}
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
                    unread={dmId != null && isUnread(dmId)}
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
              const sender = teamByUserId[m.sender_id];
              const mine = m.sender_id === currentUserId;
              const name = mine ? 'You' : (sender?.full_name || sender?.email || 'Someone');
              return (
                <div key={m.id} className="flex flex-col">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-bold" style={{ color: mine ? t.accent : t.text }}>{name}</span>
                    <span className="text-[10px]" style={{ color: t.faint }}>{formatMessageTime(m.created_at)}</span>
                  </div>
                  <div className="text-[14px] whitespace-pre-wrap break-words mt-0.5" style={{ color: t.bodyText }}>{m.body}</div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Composer */}
          {selectedId && (
            <div className="px-4 py-3 border-t flex items-end gap-3" style={{ borderColor: t.border }}>
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
                disabled={sending || !draft.trim()}
                className="px-6 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0"
                style={{ background: t.sendBg, color: t.sendText }}
              >
                {sending ? 'SENDING…' : 'SEND'}
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function SidebarRow({ active, unread, onClick, label, t }) {
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
      {unread && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.accent }} />}
    </button>
  );
}
