'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

// /notifications/settings
//
// Per-type notification preferences. In-app is always on \u2014 the toggle is
// visible but disabled with a small "always on" label so users know why.
// Push toggles are shown but disabled with a "Coming soon" chip until Phase 2.
// Essential types (ticket confirmations, refunds, welcome, etc.) don't appear
// here at all \u2014 the API filters them out because we always deliver them.

export default function SettingsClient() {
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingType, setSavingType] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/notifications/preferences');
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || 'Failed to load');
        setTypes(body.types || []);
      } catch (err) {
        setError(err?.message || 'Something went wrong');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const grouped = useMemo(() => {
    const g = new Map();
    for (const t of types) {
      if (!g.has(t.category)) g.set(t.category, []);
      g.get(t.category).push(t);
    }
    return Array.from(g.entries()); // [[category, [types]]]
  }, [types]);

  const setPref = useCallback(async (typeId, patch) => {
    setSavingType(typeId);
    setTypes((prev) => prev.map((t) => (t.id === typeId ? { ...t, channels: { ...t.channels, ...patch } } : t)));
    try {
      await fetch('/api/notifications/preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: typeId, ...patch }),
      });
    } catch { /* optimistic ok */ }
    setSavingType(null);
  }, []);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <Link href="/notifications" style={styles.back}>&larr; BACK</Link>
        <h1 style={styles.h1}>Notification Settings</h1>
      </div>

      <p style={styles.intro}>
        Essential updates (ticket confirmations, refunds, membership changes) are always delivered.
        Toggle the optional categories below.
      </p>

      {loading ? (
        <div style={styles.empty}>Loading\u2026</div>
      ) : error ? (
        <div style={styles.error}>{error}</div>
      ) : (
        <div style={styles.groups}>
          {grouped.map(([category, rows]) => (
            <section key={category} style={styles.group}>
              <h2 style={styles.h2}>{prettifyCategory(category)}</h2>
              <ul style={styles.list}>
                {rows.map((t) => (
                  <li key={t.id} style={styles.row}>
                    <div style={styles.rowMeta}>
                      <div style={styles.rowTitle}>{t.label}</div>
                      <div style={styles.rowDesc}>{t.description}</div>
                    </div>
                    <div style={styles.rowToggles}>
                      <Toggle
                        label="In-app"
                        checked={true}
                        disabled
                        note="Always on"
                      />
                      <Toggle
                        label="Email"
                        checked={!!t.channels.email}
                        onChange={(v) => setPref(t.id, { email: v })}
                        busy={savingType === t.id}
                      />
                      <Toggle
                        label="Push"
                        checked={!!t.channels.push}
                        disabled
                        note="Coming soon"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({ label, checked, disabled, onChange, note, busy }) {
  return (
    <label style={{ ...styles.toggle, opacity: disabled ? 0.55 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <span style={styles.toggleLabel}>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled || busy}
        onChange={(e) => onChange && onChange(e.target.checked)}
        style={{ accentColor: '#d9c48c' }}
      />
      {note ? <span style={styles.toggleNote}>{note}</span> : null}
    </label>
  );
}

function prettifyCategory(c) {
  return String(c || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

const styles = {
  page: {
    maxWidth: 720, margin: '0 auto', padding: '32px 20px', color: '#f5f5f5',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  },
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 },
  back: {
    fontSize: 11, letterSpacing: 2, color: '#8a8a8a', textDecoration: 'none',
    border: '1px solid rgba(255,255,255,0.1)', padding: '6px 10px', borderRadius: 999,
  },
  h1: { fontSize: 24, fontWeight: 300, letterSpacing: 1, margin: 0 },
  intro: { fontSize: 13, color: '#8a8a8a', marginBottom: 24 },
  groups: { display: 'flex', flexDirection: 'column', gap: 32 },
  group: {},
  h2: { fontSize: 12, letterSpacing: 3, color: '#d9c48c', textTransform: 'uppercase', marginBottom: 12, fontWeight: 500 },
  list: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 1 },
  row: {
    background: '#111', borderRadius: 8, padding: '16px 20px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap',
  },
  rowMeta: { flex: 1, minWidth: 200 },
  rowTitle: { fontSize: 14, fontWeight: 500, color: '#f5f5f5', marginBottom: 2 },
  rowDesc: { fontSize: 12, color: '#8a8a8a' },
  rowToggles: { display: 'flex', gap: 20 },
  toggle: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontSize: 11, color: '#a0a0a0' },
  toggleLabel: { letterSpacing: 1 },
  toggleNote: { fontSize: 9, color: '#666' },
  empty: { padding: 60, textAlign: 'center', color: '#8a8a8a' },
  error: { padding: 24, textAlign: 'center', color: '#ff8686' },
};
