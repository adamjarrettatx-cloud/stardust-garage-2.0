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
import UnderlineTabs from '../components/UnderlineTabs';

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

        {/* Search sits above the tabs — matches the Contacts / Members pattern.
            The query filters within whichever tab is open, rather than being
            scoped to one of them. */}
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email or phone"
          className="w-full max-w-[420px] mb-5 px-5 py-3 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30"
          style={{
            background: theme.neutralChipBg,
            borderColor: theme.cardBorder,
            color: theme.text,
          }}
        />

        {/* Tabs — shared UnderlineTabs so the strip matches every other in-page
            filter in the admin panel (Members, Applications, Pay Requests, etc). */}
        {tabOrder.length ? (
          <UnderlineTabs
            tabs={tabOrder.map((id) => ({
              id,
              label: tabMeta[id]?.label,
              count: counts?.[id] || 0,
              color: tabMeta[id]?.accent,
            }))}
            active={active}
            onChange={setActive}
            ariaLabel="Filter accounts by lifecycle state"
            testId="membership-journey"
          />
        ) : null}

        {/* One-line context row: what this tab means, plus MRR on paying tiers.
            Kept intentionally quiet — no coloured panel bar, no card chrome. */}
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4 -mt-4">
          <div className="text-[13px]" style={{ color: theme.muted }}>
            {activeMeta?.hint}
          </div>
          {showMrr ? (
            <div className="text-[13px]" style={{ color: theme.mutedStrong }}>
              <span className="text-[11px] uppercase tracking-[0.14em] mr-2" style={{ color: theme.muted }}>
                Monthly recurring
              </span>
              <span className="font-semibold" style={{ color: theme.text }}>{fmtCents(activeMrr)}</span>
            </div>
          ) : null}
        </div>

        {/* Profile list — single card, uniform rows for every tab. */}
        <div
          className="rounded-[16px] border overflow-hidden"
          style={{ background: theme.cardBg, borderColor: theme.cardBorder }}
        >
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
