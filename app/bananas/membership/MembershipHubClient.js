'use client';

// Membership hub — tabbed view.
//
// Six lifecycle states as tabs:
//
//   Guest · Trial Ready · Trial Activated · The Weekender · The Builder · The Insider
//
// Each tab is a clean, scannable list of profiles currently in that state.
// No funnel chart, no timeseries, no KPI clutter. The counts on the tabs
// are the funnel. Selecting a tab reveals a search box, the tab's hint line,
// and the profile list; nothing else.
//
// Deliberately narrow: applications-in-review, past-due members, and
// cancelling members are the responsibility of the existing
// /bananas/applications and /bananas/members surfaces. This hub is
// "who is at each state right now".

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuthenticatedTheme } from '@/app/components/AuthenticatedThemeProvider';
import { ANALYTICS_THEMES, FINANCIAL_THEMES } from '@/lib/admin-theme';
import { centsToUsd } from '@/lib/event-analytics';

const THEMES = {
  dark:  { ...ANALYTICS_THEMES.dark,  ...FINANCIAL_THEMES.dark },
  light: { ...ANALYTICS_THEMES.light, ...FINANCIAL_THEMES.light },
};

// -----------------------------------------------------------------------
// Formatters
// -----------------------------------------------------------------------

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtWhen(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
function fmtCents(cents) {
  if (cents === null || cents === undefined) return '—';
  return centsToUsd(cents);
}
function fmtNumber(x) {
  if (x === null || x === undefined) return '—';
  return Number(x).toLocaleString('en-US');
}

// -----------------------------------------------------------------------
// Avatar (photo or initials fallback)
// -----------------------------------------------------------------------

function Avatar({ name, photoUrl, theme, size = 44, accent }) {
  const initials = (name || '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div
      className="flex items-center justify-center rounded-full overflow-hidden shrink-0"
      style={{
        width: size, height: size,
        background: theme.neutralChipBg,
        border: `1px solid ${accent || theme.cardBorder}`,
        color: theme.mutedStrong,
        fontSize: size * 0.34,
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : initials}
    </div>
  );
}

// -----------------------------------------------------------------------
// The one context line per row, chosen for the row's kind
// -----------------------------------------------------------------------

function contextLine(row) {
  if (row.kind === 'account') {
    const verified = row.phone_verified ? 'phone verified' : 'phone unverified';
    return `Signed up ${fmtDate(row.created_at)} · ${row.age_days}d ago · ${verified}`;
  }
  if (row.kind === 'trial') {
    if (row.visits > 0) return `Visited ${row.visits}× · last ${fmtWhen(row.last_visit)}`;
    if (row.activated_at) return `Activated ${fmtDate(row.activated_at)} · ${row.days_left}d left`;
    const activateHint = row.days_left != null ? ` · ${row.days_left}d to activate` : '';
    return `Issued ${fmtDate(row.issued_at)}${activateHint}`;
  }
  if (row.kind === 'member') {
    return `${fmtCents(row.monthly_cents)}/mo · member since ${fmtDate(row.member_since)}`;
  }
  return '';
}

// -----------------------------------------------------------------------
// Profile row — one uniform card layout for every tab
// -----------------------------------------------------------------------

function ProfileRow({ row, accent, theme }) {
  const inner = (
    <div
      className="flex items-center gap-4 px-5 py-4 transition-colors"
      style={{ borderBottom: `1px solid ${theme.rowBorder}` }}
    >
      <Avatar name={row.full_name} photoUrl={row.photo_url} theme={theme} accent={accent} />
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-medium truncate" style={{ color: theme.text }}>
          {row.full_name || row.email || 'Unnamed'}
        </div>
        <div className="text-[12px] mt-0.5 truncate" style={{ color: theme.muted }}>
          {contextLine(row)}
        </div>
      </div>
      <div className="hidden md:flex flex-col items-end text-right shrink-0">
        {row.email ? (
          <div className="text-[12px] truncate max-w-[240px]" style={{ color: theme.mutedStrong }}>
            {row.email}
          </div>
        ) : null}
        {row.phone ? (
          <div className="text-[11px] font-mono mt-0.5" style={{ color: theme.muted }}>
            {row.phone}
          </div>
        ) : null}
      </div>
    </div>
  );

  if (!row.href) return inner;
  return (
    <Link href={row.href} className="block hover:opacity-90 transition-opacity">
      {inner}
    </Link>
  );
}

// -----------------------------------------------------------------------
// Tab strip — pill-shaped tabs with counts, mobile-scrollable
// -----------------------------------------------------------------------

function TabStrip({ tabOrder, tabMeta, counts, active, onSelect, theme }) {
  return (
    <div
      className="flex overflow-x-auto -mx-1 px-1 pb-1 mb-4"
      style={{ scrollbarWidth: 'thin' }}
    >
      <div className="flex gap-2">
        {tabOrder.map((id) => {
          const meta = tabMeta[id];
          const isActive = id === active;
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              className="shrink-0 rounded-full px-4 py-2 text-[12px] font-semibold tracking-[0.04em] transition-colors"
              style={{
                background: isActive ? meta.accent : theme.cardBg,
                color: isActive ? '#0a0a0a' : theme.text,
                border: `1px solid ${isActive ? meta.accent : theme.cardBorder}`,
                letterSpacing: '0.02em',
              }}
            >
              <span>{meta.label}</span>
              <span
                className="ml-2 rounded-full text-[11px] font-semibold px-2 py-[1px]"
                style={{
                  background: isActive ? 'rgba(10,10,10,0.16)' : theme.neutralChipBg,
                  color: isActive ? '#0a0a0a' : theme.mutedStrong,
                }}
              >
                {fmtNumber(counts?.[id] || 0)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// The hub
// -----------------------------------------------------------------------

const DEFAULT_TAB = 'guest';

export default function MembershipHubClient() {
  const { theme: mode } = useAuthenticatedTheme();
  const theme = THEMES[mode] || THEMES.dark;

  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [active, setActive]   = useState(DEFAULT_TAB);
  const [q, setQ]             = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/admin/membership/journey', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => { if (!cancelled) setPayload(json); })
      .catch((e) => { if (!cancelled) setError(e.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const tabOrder = payload?.tab_order || [];
  const tabMeta  = payload?.tab_meta  || {};
  const counts   = payload?.counts    || {};
  const mrrCents = payload?.mrr_cents || {};
  const activeMeta = tabMeta[active];

  // Memo the tab's rows so the search useMemo below has a stable input
  // even when `payload` re-renders unchanged.
  const rows = useMemo(() => payload?.tabs?.[active] || [], [payload, active]);

  // Client-side search across name + email + phone. Cheap because each tab
  // is bounded (a few thousand rows at most).
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((r) => {
      const hay = `${r.full_name || ''} ${r.email || ''} ${r.phone || ''}`.toLowerCase();
      return hay.includes(query);
    });
  }, [rows, q]);

  // Reset the search field whenever the active tab changes so a stale query
  // doesn't hide the newly-selected list.
  useEffect(() => { setQ(''); }, [active]);

  // MRR line only shown on paying-tier tabs.
  const showMrr = ['weekender', 'builder', 'insider'].includes(active);
  const activeMrr = mrrCents[active] || 0;

  return (
    <div className="space-y-6" style={{ color: theme.text }}>
      <div className="max-w-[1200px] mx-auto">

        {/* Header */}
        <header className="mb-6">
          <div className="text-[10px] font-semibold tracking-[0.22em] uppercase mb-1" style={{ color: theme.muted }}>
            Bananas · Membership
          </div>
          <h1
            className="text-[32px] font-semibold leading-none"
            style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", letterSpacing: '-0.02em' }}
          >
            The Journey
          </h1>
          <p className="text-[13px] mt-2 max-w-[640px]" style={{ color: theme.muted }}>
            Every account by lifecycle state. Pick a tab; see the list.
          </p>
        </header>

        {error ? (
          <div
            className="rounded-[12px] border p-4 mb-4 text-[13px]"
            style={{ background: theme.cardBg, borderColor: theme.cardBorder, color: '#f87171' }}
          >
            Failed to load: {error}
          </div>
        ) : null}

        {/* Tabs */}
        {tabOrder.length ? (
          <TabStrip
            tabOrder={tabOrder}
            tabMeta={tabMeta}
            counts={counts}
            active={active}
            onSelect={setActive}
            theme={theme}
          />
        ) : null}

        {/* Panel */}
        <div
          className="rounded-[16px] border overflow-hidden"
          style={{ background: theme.cardBg, borderColor: theme.cardBorder }}
        >
          {/* Panel header — hint + count + search */}
          <div
            className="flex flex-wrap items-center gap-3 px-5 py-4 border-b"
            style={{ borderColor: theme.cardBorder, background: activeMeta ? activeMeta.accent + '10' : 'transparent' }}
          >
            <div className="flex-1 min-w-[220px]">
              <div className="text-[11px] font-semibold tracking-[0.16em] uppercase" style={{ color: activeMeta?.accent }}>
                {activeMeta?.label}
              </div>
              <div className="text-[13px] mt-0.5" style={{ color: theme.mutedStrong }}>
                {activeMeta?.hint}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {showMrr ? (
                <div className="text-right">
                  <div className="text-[10px] font-semibold tracking-[0.14em] uppercase" style={{ color: theme.muted }}>
                    Monthly recurring
                  </div>
                  <div className="text-[16px] font-semibold" style={{ color: theme.text, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
                    {fmtCents(activeMrr)}
                  </div>
                </div>
              ) : null}
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, email or phone"
                className="rounded-full px-4 py-2 text-[13px] outline-none min-w-[240px]"
                style={{
                  background: theme.neutralChipBg,
                  border: `1px solid ${theme.cardBorder}`,
                  color: theme.text,
                }}
              />
            </div>
          </div>

          {/* Profile list */}
          {loading && !payload ? (
            <div className="p-10 text-center text-[13px]" style={{ color: theme.muted }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-[13px]" style={{ color: theme.muted }}>
              {rows.length === 0
                ? 'Nobody here right now.'
                : 'No matches for your search.'}
            </div>
          ) : (
            <div>
              {filtered.map((row) => (
                <ProfileRow key={`${row.kind}-${row.id}`} row={row} accent={activeMeta?.accent} theme={theme} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
