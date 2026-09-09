'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

// /notifications
//
// Chronological feed of the signed-in user's notifications, newest first.
// Rendered flat \u2014 unread items get a subtle champagne underline. Tapping a
// row marks it read; tapping "Mark all read" empties the badge. Deep links
// (data.url) open in the same tab.
//
// This page is the source-of-truth surface for the notification system on
// the web. The push channel (Phase 2) will deep-link INTO these same feed
// entries by opening data.url, so the layout here mirrors what the mobile
// app will render.

export default function NotificationsClient() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (opts = {}) => {
    try {
      const url = new URL('/api/notifications', window.location.origin);
      url.searchParams.set('limit', '50');
      if (opts.before) url.searchParams.set('before', opts.before);
      const res = await fetch(url.toString());
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Failed to load');
      if (opts.before) {
        setItems((prev) => [...prev, ...(body.items || [])]);
      } else {
        setItems(body.items || []);
      }
      setCursor(body.next_cursor || null);
    } catch (err) {
      setError(err?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const markOne = useCallback(async (id) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    try {
      await fetch(`/api/notifications/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ read: true }) });
    } catch { /* optimistic ok */ }
  }, []);

  const markAllRead = useCallback(async () => {
    setBusy(true);
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
    try {
      await fetch('/api/notifications/read-all', { method: 'POST' });
    } catch { /* optimistic ok */ }
    setBusy(false);
  }, []);

  const unreadCount = items.filter((n) => !n.read_at).length;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.h1}>Notifications</h1>
        <div style={styles.headerRight}>
          <Link href="/notifications/settings" style={styles.settingsLink}>SETTINGS</Link>
          <button
            type="button"
            style={{ ...styles.markAllBtn, opacity: unreadCount === 0 || busy ? 0.4 : 1 }}
            onClick={markAllRead}
            disabled={unreadCount === 0 || busy}
          >
            MARK ALL READ
          </button>
        </div>
      </div>

      {loading ? (
        <div style={styles.empty}>Loading\u2026</div>
      ) : error ? (
        <div style={styles.error}>{error}</div>
      ) : items.length === 0 ? (
        <div style={styles.empty}>You\u2019re all caught up.</div>
      ) : (
        <ul style={styles.list}>
          {items.map((n) => {
            const unread = !n.read_at;
            const href = n?.data?.url || null;
            const inner = (
              <>
                <div style={styles.rowTop}>
                  <div style={{ ...styles.title, fontWeight: unread ? 700 : 500 }}>{n.title}</div>
                  <div style={styles.time}>{formatTime(n.created_at)}</div>
                </div>
                {n.body ? <div style={styles.body}>{n.body}</div> : null}
              </>
            );
            return (
              <li key={n.id} style={{ ...styles.row, ...(unread ? styles.rowUnread : null) }}>
                {href ? (
                  <Link href={href} style={styles.rowLink} onClick={() => unread && markOne(n.id)}>
                    {inner}
                  </Link>
                ) : (
                  <button type="button" style={styles.rowButton} onClick={() => unread && markOne(n.id)}>
                    {inner}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {cursor ? (
        <button type="button" style={styles.loadMoreBtn} onClick={() => load({ before: cursor })}>
          Load more
        </button>
      ) : null}
    </div>
  );
}

function formatTime(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  const now = new Date();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return then.toLocaleDateString();
}

const styles = {
  page: {
    maxWidth: 720, margin: '0 auto', padding: '32px 20px', color: '#f5f5f5',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  h1: { fontSize: 28, fontWeight: 300, letterSpacing: 1, margin: 0 },
  headerRight: { display: 'flex', gap: 12, alignItems: 'center' },
  settingsLink: {
    fontSize: 11, letterSpacing: 2, color: '#8a8a8a', textDecoration: 'none',
    border: '1px solid rgba(255,255,255,0.1)', padding: '8px 12px', borderRadius: 999,
  },
  markAllBtn: {
    fontSize: 11, letterSpacing: 2, color: '#d9c48c', background: 'transparent',
    border: '1px solid #d9c48c', padding: '8px 12px', borderRadius: 999, cursor: 'pointer',
  },
  empty: { padding: 60, textAlign: 'center', color: '#8a8a8a', fontSize: 14 },
  error: { padding: 24, textAlign: 'center', color: '#ff8686' },
  list: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 1 },
  row: { background: '#111', borderRadius: 8 },
  rowUnread: { borderLeft: '2px solid #d9c48c' },
  rowLink: { display: 'block', padding: '16px 20px', color: 'inherit', textDecoration: 'none' },
  rowButton: {
    display: 'block', padding: '16px 20px', color: 'inherit', background: 'transparent',
    border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', font: 'inherit',
  },
  rowTop: { display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 4 },
  title: { fontSize: 15, color: '#f5f5f5' },
  time: { fontSize: 11, color: '#666', flexShrink: 0 },
  body: { fontSize: 13, color: '#a0a0a0', lineHeight: 1.5 },
  loadMoreBtn: {
    marginTop: 24, width: '100%', padding: '14px', borderRadius: 8,
    background: 'transparent', color: '#8a8a8a', border: '1px solid rgba(255,255,255,0.1)',
    cursor: 'pointer', fontSize: 12, letterSpacing: 2,
  },
};
