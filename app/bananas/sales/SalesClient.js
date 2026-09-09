'use client';

// Sales dashboard client. Renders four tabs over a shared KPI strip:
//
//   Overview   — trend chart + revenue by event + at-a-glance rollups.
//   Orders     — recent orders across all events, filterable by status.
//   Refunds    — full/partial refund log + comp ticket log.
//   Memberships— MRR, active/trialing/past-due counts, plan mix, attention list.
//   Payouts    — live Stripe balance, upcoming payout, recent payout history.
//
// Design goals:
//   * Legible on the venue's admin theme (light + dark tokens) via
//     useAuthenticatedTheme, matching /bananas/financials.
//   * Every dollar shown in USD via centsToUsd — cents live in the API
//     payload, conversion happens only at the render edge.
//   * Empty states are honest (say "no orders yet", never blank cards).
//   * No third-party chart lib: the trend chart is a hand-rolled SVG so we
//     keep the deploy footprint the same as the rest of /bananas.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { centsToUsd } from '@/lib/event-analytics';
import { useAuthenticatedTheme } from '@/app/components/AuthenticatedThemeProvider';
import { ANALYTICS_THEMES, FINANCIAL_THEMES } from '@/lib/admin-theme';

// Merged palette so we can pull from both the calendar (rev/warn/pos) and
// analytics (tableBorder/rowBorder) vocabularies without redefining tokens.
// Every shared key holds byte-identical values in both source palettes.
const THEMES = {
  dark: { ...ANALYTICS_THEMES.dark, ...FINANCIAL_THEMES.dark },
  light: { ...ANALYTICS_THEMES.light, ...FINANCIAL_THEMES.light },
};

const RANGES = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'all', label: 'All time' },
];

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'orders', label: 'Orders' },
  { id: 'refunds', label: 'Refunds & Comps' },
  { id: 'memberships', label: 'Memberships' },
  { id: 'payouts', label: 'Payouts' },
];

// -----------------------------------------------------------------------
// Formatters
// -----------------------------------------------------------------------

function fmtWhen(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}
function fmtCents(cents) {
  if (cents === null || cents === undefined) return '—';
  return centsToUsd(cents);
}

// Little status pill. Colour chosen from the theme so it stays readable
// against both light and dark cards.
function StatusPill({ status, tone = 'neutral', theme }) {
  const palette = {
    good:    { bg: theme.revChipBg,     border: theme.revChipBorder,      text: theme.rev },
    warn:    { bg: theme.warnBadgeBg,   border: theme.warnCardBorder,     text: theme.warn },
    err:     { bg: theme.errBg,         border: theme.err,                text: theme.err },
    neutral: { bg: theme.neutralChipBg, border: theme.neutralChipBorder,  text: theme.mutedStrong },
  }[tone] || {};
  return (
    <span
      className="inline-flex items-center px-2 py-[3px] rounded-full text-[11px] font-semibold uppercase tracking-[0.06em]"
      style={{ background: palette.bg, border: `1px solid ${palette.border}`, color: palette.text }}
    >
      {status}
    </span>
  );
}

function statusTone(status) {
  if (status === 'paid') return 'good';
  if (status === 'refunded' || status === 'partial_refund') return 'warn';
  if (status === 'failed' || status === 'void') return 'err';
  return 'neutral';
}

// -----------------------------------------------------------------------
// KPI card
// -----------------------------------------------------------------------
function Kpi({ label, value, hint, theme, accent = 'text' }) {
  const valueColor = {
    text: theme.textStrong,
    rev: theme.rev,
    warn: theme.warn,
    err: theme.err,
    pos: theme.pos,
  }[accent] || theme.textStrong;

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: theme.cardBg,
        border: `1px solid ${theme.cardBorder}`,
      }}
    >
      <div
        className="text-[11px] font-bold uppercase tracking-[0.12em]"
        style={{ color: theme.muted }}
      >
        {label}
      </div>
      <div
        className="mt-1 text-[26px] font-extrabold -tracking-[0.01em] leading-[1.15]"
        style={{ color: valueColor, fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-1 text-[12px]" style={{ color: theme.muted }}>
          {hint}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// Trend chart (SVG). Bars = gross paid per day; red overlay = refunds.
// -----------------------------------------------------------------------
function TrendChart({ series, theme }) {
  if (!series || series.length === 0) {
    return (
      <div style={{ color: theme.muted }} className="text-sm p-6 text-center">
        No sales in this range yet.
      </div>
    );
  }
  const width = 780;
  const height = 220;
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const max = Math.max(1, ...series.map((s) => Math.max(s.gross, s.refunds)));
  const barW = Math.max(2, chartW / series.length - 2);

  // Y-axis rounded to a nice number
  const niceMax = niceCeil(max);
  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => (niceMax * i) / yTicks);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Daily sales trend">
      {/* grid + y-axis labels */}
      {tickVals.map((v, i) => {
        const y = padT + chartH - (v / niceMax) * chartH;
        return (
          <g key={i}>
            <line x1={padL} x2={width - padR} y1={y} y2={y}
              stroke={theme.gridLine} strokeWidth="1" />
            <text x={padL - 6} y={y + 4} textAnchor="end"
              fontSize="10" fill={theme.muted} fontFamily="'Plus Jakarta Sans', sans-serif">
              {centsToUsd(Math.round(v))}
            </text>
          </g>
        );
      })}
      {/* bars */}
      {series.map((s, i) => {
        const x = padL + i * (chartW / series.length) + 1;
        const grossH = (s.gross / niceMax) * chartH;
        const refundH = (s.refunds / niceMax) * chartH;
        return (
          <g key={s.day}>
            <rect
              x={x} y={padT + chartH - grossH}
              width={barW} height={Math.max(grossH, s.gross > 0 ? 1 : 0)}
              fill={theme.rev} opacity={0.9}
              rx={1.5}
            >
              <title>{`${s.day} · ${centsToUsd(s.gross)} gross · ${s.orders} order${s.orders === 1 ? '' : 's'}`}</title>
            </rect>
            {s.refunds > 0 && (
              <rect
                x={x} y={padT + chartH - refundH}
                width={barW} height={Math.max(refundH, 1)}
                fill={theme.err} opacity={0.85}
                rx={1.5}
              >
                <title>{`${s.day} · ${centsToUsd(s.refunds)} refunded`}</title>
              </rect>
            )}
          </g>
        );
      })}
      {/* x-axis: first, midpoint, last date label */}
      {[0, Math.floor(series.length / 2), series.length - 1].map((i) => {
        if (!series[i]) return null;
        const x = padL + i * (chartW / series.length) + barW / 2;
        return (
          <text key={i} x={x} y={height - 8} textAnchor="middle"
            fontSize="10" fill={theme.muted}
            fontFamily="'Plus Jakarta Sans', sans-serif">
            {series[i].day.slice(5)}
          </text>
        );
      })}
    </svg>
  );
}

// Round up to a "nice" chart maximum so tick marks are readable dollar amounts.
function niceCeil(n) {
  if (n <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(n)));
  const scaled = n / magnitude;
  let nice;
  if (scaled <= 1) nice = 1;
  else if (scaled <= 2) nice = 2;
  else if (scaled <= 5) nice = 5;
  else nice = 10;
  return nice * magnitude;
}

// -----------------------------------------------------------------------
// Main component
// -----------------------------------------------------------------------
export default function SalesClient({ initialRange = '30d' }) {
  const { theme: themeMode } = useAuthenticatedTheme();
  const theme = THEMES[themeMode] || THEMES.dark;

  const [range, setRange] = useState(initialRange);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async (r) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sales/summary?range=${encodeURIComponent(r)}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`Failed to load sales (${res.status})`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e.message || 'Failed to load sales');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(range); }, [load, range]);

  // Keep URL query param in sync so the range survives a page refresh /
  // shareable link, without a full navigation (same pattern as AdminShell).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('range') !== range) {
      url.searchParams.set('range', range);
      window.history.replaceState(null, '', url);
    }
  }, [range]);

  const money = data?.money;
  const counts = data?.counts;
  const memberships = data?.memberships;

  const currentRange = RANGES.find((r) => r.id === range) || RANGES[1];

  return (
    <div className="space-y-6">
      {/* Header row: title + range picker */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            className="text-[28px] font-extrabold -tracking-[0.02em]"
            style={{ color: theme.textStrong, fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Sales
          </h1>
          <p className="mt-1 text-[13.5px]" style={{ color: theme.muted }}>
            Everything flowing through the first-party payment stack:
            ticket orders, memberships, refunds, comps, and Stripe payouts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="inline-flex items-center rounded-lg overflow-hidden"
            style={{ border: `1px solid ${theme.border}` }}
          >
            {RANGES.map((r) => {
              const isActive = r.id === range;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRange(r.id)}
                  className="px-3 py-1.5 text-[12.5px] font-semibold transition-colors"
                  style={{
                    background: isActive ? theme.textStrong : 'transparent',
                    color: isActive ? (themeMode === 'dark' ? '#0a0a0a' : '#ffffff') : theme.mutedStrong,
                  }}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => load(range)}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition-colors"
            style={{
              border: `1px solid ${theme.border}`,
              color: theme.mutedStrong,
              opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div
          className="rounded-lg p-3 text-sm"
          style={{ background: theme.errBg, color: theme.err, border: `1px solid ${theme.err}` }}
        >
          {error}
        </div>
      )}

      {/* KPI strip — always visible on every tab so the headline never leaves the frame */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi
          label="Gross"
          value={fmtCents(money?.gross_cents ?? 0)}
          hint={`${counts?.paid_orders ?? 0} paid orders · ${currentRange.label.toLowerCase()}`}
          theme={theme}
          accent="rev"
        />
        <Kpi
          label="Refunds"
          value={fmtCents(money?.refunded_cents ?? 0)}
          hint={`${counts?.refunded_orders ?? 0} refunded orders`}
          theme={theme}
          accent="warn"
        />
        <Kpi
          label="Net (after refunds)"
          value={fmtCents(money?.net_cents ?? 0)}
          hint="Gross minus every refund"
          theme={theme}
          accent="rev"
        />
        <Kpi
          label="Avg order"
          value={fmtCents(money?.aov_cents ?? 0)}
          hint="Excludes $0 comps"
          theme={theme}
        />
        <Kpi
          label="MRR"
          value={fmtCents(memberships?.mrr_cents ?? 0)}
          hint={`${memberships?.active_count ?? 0} active members`}
          theme={theme}
          accent="pos"
        />
        <Kpi
          label="Tax owed"
          value={fmtCents(money?.net_tax_owed_cents ?? 0)}
          hint="Collected − refunded"
          theme={theme}
        />
      </div>

      {/* Tab bar */}
      <div
        className="flex gap-1 overflow-x-auto"
        style={{ borderBottom: `1px solid ${theme.borderSoft}` }}
        role="tablist"
      >
        {TABS.map((t) => {
          const isActive = t.id === tab;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(t.id)}
              className="px-4 py-2.5 text-[13.5px] font-semibold whitespace-nowrap transition-colors"
              style={{
                color: isActive ? theme.textStrong : theme.muted,
                borderBottom: `2px solid ${isActive ? theme.rev : 'transparent'}`,
                marginBottom: '-1px',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab bodies */}
      {loading && !data && (
        <div
          className="rounded-xl p-8 text-center text-sm"
          style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, color: theme.muted }}
        >
          Loading sales data…
        </div>
      )}

      {data && tab === 'overview'   && <OverviewTab data={data} theme={theme} />}
      {data && tab === 'orders'     && <OrdersTab data={data} theme={theme} />}
      {data && tab === 'refunds'    && <RefundsTab data={data} theme={theme} />}
      {data && tab === 'memberships'&& <MembershipsTab data={data} theme={theme} />}
      {data && tab === 'payouts'    && <PayoutsTab data={data} theme={theme} />}
    </div>
  );
}

// -----------------------------------------------------------------------
// Tab: Overview
// -----------------------------------------------------------------------
function OverviewTab({ data, theme }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div
        className="lg:col-span-2 rounded-xl p-5"
        style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}
      >
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-[13px] font-bold uppercase tracking-[0.12em]" style={{ color: theme.muted }}>
            Daily sales
          </div>
          <div className="text-[12px]" style={{ color: theme.muted }}>
            <span className="inline-flex items-center gap-1.5 mr-3">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: theme.rev }} />
              Gross
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: theme.err }} />
              Refunds
            </span>
          </div>
        </div>
        <TrendChart series={data.timeseries} theme={theme} />
      </div>

      <div
        className="rounded-xl p-5"
        style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}
      >
        <div className="text-[13px] font-bold uppercase tracking-[0.12em] mb-3" style={{ color: theme.muted }}>
          At a glance
        </div>
        <dl className="space-y-2.5 text-[13.5px]">
          <Row label="Tax collected"  value={fmtCents(data.money.tax_collected_cents)} theme={theme} />
          <Row label="Tax refunded"   value={fmtCents(data.money.tax_refunded_cents)}  theme={theme} />
          <Row label="Comp orders"    value={String(data.counts.comps)}                 theme={theme} />
          <Row label="Active members" value={String(data.memberships.active_count)}     theme={theme} />
          <Row label="Trialing"       value={String(data.memberships.trialing_count)}   theme={theme} />
          <Row label="Past due"       value={String(data.memberships.past_due_count)}
               tone={data.memberships.past_due_count > 0 ? 'warn' : undefined}          theme={theme} />
          <Row label="Cancelling"     value={String(data.memberships.cancelling_count)} theme={theme} />
          <Row label="New in range"   value={String(data.memberships.new_in_range_count)} theme={theme} />
        </dl>
      </div>

      <div
        className="lg:col-span-3 rounded-xl overflow-hidden"
        style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}
      >
        <div
          className="px-5 py-3 flex items-baseline justify-between"
          style={{ borderBottom: `1px solid ${theme.divider}` }}
        >
          <div className="text-[13px] font-bold uppercase tracking-[0.12em]" style={{ color: theme.muted }}>
            Revenue by event · top 10
          </div>
          <div className="text-[12px]" style={{ color: theme.muted }}>
            Sorted by net (gross − refunds)
          </div>
        </div>
        {data.revenue_by_event.length === 0 ? (
          <div className="p-6 text-center text-sm" style={{ color: theme.muted }}>
            No paid orders in this range yet.
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ color: theme.muted }} className="text-[11px] uppercase tracking-[0.1em]">
                <Th theme={theme}>Event</Th>
                <Th theme={theme}>Date</Th>
                <Th theme={theme} align="right">Orders</Th>
                <Th theme={theme} align="right">Gross</Th>
                <Th theme={theme} align="right">Refunds</Th>
                <Th theme={theme} align="right">Net</Th>
                <Th theme={theme} align="right">Comps</Th>
              </tr>
            </thead>
            <tbody>
              {data.revenue_by_event.map((r, i) => (
                <tr key={r.event_id + i} style={{ borderTop: `1px solid ${theme.rowBorder}` }}>
                  <Td theme={theme}>
                    {r.event_id === 'unknown' ? (
                      <span style={{ color: theme.muted }}>{r.title}</span>
                    ) : (
                      <Link
                        href={`/bananas/tickets/${r.event_id}`}
                        className="font-semibold hover:underline"
                        style={{ color: theme.textStrong }}
                      >
                        {r.title}
                      </Link>
                    )}
                  </Td>
                  <Td theme={theme} muted>{fmtDate(r.event_date)}</Td>
                  <Td theme={theme} align="right">{r.orders}</Td>
                  <Td theme={theme} align="right">{fmtCents(r.gross)}</Td>
                  <Td theme={theme} align="right" tone={r.refunds > 0 ? 'warn' : undefined}>
                    {r.refunds > 0 ? fmtCents(r.refunds) : '—'}
                  </Td>
                  <Td theme={theme} align="right" bold tone="rev">
                    {fmtCents(r.gross - r.refunds)}
                  </Td>
                  <Td theme={theme} align="right" muted>{r.comps || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Tab: Orders
// -----------------------------------------------------------------------
function OrdersTab({ data, theme }) {
  const [filter, setFilter] = useState('all');
  const rows = useMemo(() => {
    if (filter === 'all') return data.recent_orders;
    return data.recent_orders.filter((o) => o.status === filter);
  }, [data.recent_orders, filter]);

  const filters = [
    { id: 'all',            label: `All (${data.recent_orders.length})` },
    { id: 'paid',           label: `Paid (${data.recent_orders.filter((o) => o.status === 'paid').length})` },
    { id: 'refunded',       label: `Refunded (${data.recent_orders.filter((o) => o.status === 'refunded').length})` },
    { id: 'partial_refund', label: `Partial refund (${data.recent_orders.filter((o) => o.status === 'partial_refund').length})` },
    { id: 'pending',        label: `Pending (${data.recent_orders.filter((o) => o.status === 'pending').length})` },
    { id: 'failed',         label: `Failed (${data.recent_orders.filter((o) => o.status === 'failed').length})` },
  ];

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}
    >
      <div className="p-4 flex flex-wrap gap-2" style={{ borderBottom: `1px solid ${theme.divider}` }}>
        {filters.map((f) => {
          const isActive = f.id === filter;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className="px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors"
              style={{
                background: isActive ? theme.textStrong : theme.neutralChipBg,
                color: isActive ? (theme.cardBg === '#ffffff' ? '#ffffff' : '#0a0a0a') : theme.mutedStrong,
                border: `1px solid ${isActive ? theme.textStrong : theme.neutralChipBorder}`,
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="p-8 text-center text-sm" style={{ color: theme.muted }}>
          No orders match this filter.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ color: theme.muted }} className="text-[11px] uppercase tracking-[0.1em]">
                <Th theme={theme}>When</Th>
                <Th theme={theme}>Buyer</Th>
                <Th theme={theme}>Event</Th>
                <Th theme={theme}>Kind</Th>
                <Th theme={theme}>Status</Th>
                <Th theme={theme} align="right">Total</Th>
                <Th theme={theme} align="right">Refunded</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} style={{ borderTop: `1px solid ${theme.rowBorder}` }}>
                  <Td theme={theme} muted>{fmtWhen(o.paid_at || o.created_at)}</Td>
                  <Td theme={theme}>
                    <div className="font-semibold" style={{ color: theme.textStrong }}>
                      {o.buyer_name || '—'}
                    </div>
                    <div className="text-[11.5px]" style={{ color: theme.muted }}>
                      {o.buyer_email}
                    </div>
                  </Td>
                  <Td theme={theme}>
                    {o.event_id ? (
                      <Link
                        href={`/bananas/tickets/${o.event_id}`}
                        className="hover:underline"
                        style={{ color: theme.textStrong }}
                      >
                        {o.event_title || '—'}
                      </Link>
                    ) : (
                      <span style={{ color: theme.muted }}>—</span>
                    )}
                  </Td>
                  <Td theme={theme} muted>
                    {o.checkout_kind === 'comp' ? 'Comp' : 'Purchase'}
                  </Td>
                  <Td theme={theme}>
                    <StatusPill status={o.status} tone={statusTone(o.status)} theme={theme} />
                  </Td>
                  <Td theme={theme} align="right" bold>{fmtCents(o.total_cents)}</Td>
                  <Td theme={theme} align="right" tone={o.refunded_cents > 0 ? 'warn' : undefined}>
                    {o.refunded_cents > 0 ? fmtCents(o.refunded_cents) : '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// Tab: Refunds & Comps
// -----------------------------------------------------------------------
function RefundsTab({ data, theme }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Panel title={`Refunds (${data.refunds.length})`} theme={theme}>
        {data.refunds.length === 0 ? (
          <Empty theme={theme}>No refunds in this range.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ color: theme.muted }} className="text-[11px] uppercase tracking-[0.1em]">
                  <Th theme={theme}>When</Th>
                  <Th theme={theme}>Buyer</Th>
                  <Th theme={theme}>Event</Th>
                  <Th theme={theme}>Type</Th>
                  <Th theme={theme} align="right">Refunded</Th>
                </tr>
              </thead>
              <tbody>
                {data.refunds.map((r) => (
                  <tr key={r.id} style={{ borderTop: `1px solid ${theme.rowBorder}` }}>
                    <Td theme={theme} muted>{fmtWhen(r.refunded_at)}</Td>
                    <Td theme={theme}>{r.buyer_email}</Td>
                    <Td theme={theme} muted>{r.event_title || '—'}</Td>
                    <Td theme={theme}>
                      <StatusPill status={r.is_full ? 'Full' : 'Partial'} tone={r.is_full ? 'err' : 'warn'} theme={theme} />
                    </Td>
                    <Td theme={theme} align="right" bold tone="warn">
                      {fmtCents(r.refunded_cents)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={`Comp tickets (${data.comps.length})`} theme={theme}>
        {data.comps.length === 0 ? (
          <Empty theme={theme}>No comps issued in this range.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ color: theme.muted }} className="text-[11px] uppercase tracking-[0.1em]">
                  <Th theme={theme}>When</Th>
                  <Th theme={theme}>Recipient</Th>
                  <Th theme={theme}>Event</Th>
                  <Th theme={theme}>Ref</Th>
                </tr>
              </thead>
              <tbody>
                {data.comps.map((c) => (
                  <tr key={c.id} style={{ borderTop: `1px solid ${theme.rowBorder}` }}>
                    <Td theme={theme} muted>{fmtWhen(c.created_at)}</Td>
                    <Td theme={theme}>
                      <div className="font-semibold" style={{ color: theme.textStrong }}>
                        {c.buyer_name || '—'}
                      </div>
                      <div className="text-[11.5px]" style={{ color: theme.muted }}>
                        {c.buyer_email}
                      </div>
                    </Td>
                    <Td theme={theme} muted>{c.event_title || '—'}</Td>
                    <Td theme={theme} muted>
                      <span className="font-mono text-[11.5px]">{c.comp_ref?.slice(0, 8) || '—'}</span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// -----------------------------------------------------------------------
// Tab: Memberships
// -----------------------------------------------------------------------
function MembershipsTab({ data, theme }) {
  const m = data.memberships;
  const planEntries = Object.entries(m.plan_breakdown || {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="grid grid-cols-2 gap-3 lg:col-span-2">
        <Kpi label="Active"     value={String(m.active_count)}     theme={theme} accent="rev" />
        <Kpi label="MRR"        value={fmtCents(m.mrr_cents)}      theme={theme} accent="pos"
             hint="Sum across active subscriptions" />
        <Kpi label="Trialing"   value={String(m.trialing_count)}   theme={theme} />
        <Kpi label="Past due"   value={String(m.past_due_count)}   theme={theme}
             accent={m.past_due_count > 0 ? 'warn' : 'text'} />
        <Kpi label="Cancelling" value={String(m.cancelling_count)} theme={theme}
             accent={m.cancelling_count > 0 ? 'warn' : 'text'} />
        <Kpi label="New in range" value={String(m.new_in_range_count)} theme={theme} />
      </div>

      <Panel title="Plan mix (active members)" theme={theme}>
        {planEntries.length === 0 ? (
          <Empty theme={theme}>No active memberships yet.</Empty>
        ) : (
          <ul className="space-y-2">
            {planEntries.map(([key, count]) => (
              <li key={key} className="flex items-center justify-between">
                <span className="text-[13px]" style={{ color: theme.text }}>{key}</span>
                <span
                  className="text-[12px] px-2 py-0.5 rounded-full font-semibold"
                  style={{
                    background: theme.neutralChipBg,
                    border: `1px solid ${theme.neutralChipBorder}`,
                    color: theme.textStrong,
                  }}
                >
                  {count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="lg:col-span-3">
        <Panel title={`Attention needed (${m.attention.length})`} theme={theme}>
          {m.attention.length === 0 ? (
            <Empty theme={theme}>Nothing to fix — every member is current.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr style={{ color: theme.muted }} className="text-[11px] uppercase tracking-[0.1em]">
                    <Th theme={theme}>Member</Th>
                    <Th theme={theme}>Plan</Th>
                    <Th theme={theme}>Status</Th>
                    <Th theme={theme}>Period ends</Th>
                    <Th theme={theme}>Cancelling?</Th>
                  </tr>
                </thead>
                <tbody>
                  {m.attention.map((row) => (
                    <tr key={row.id} style={{ borderTop: `1px solid ${theme.rowBorder}` }}>
                      <Td theme={theme}>
                        <div className="font-semibold" style={{ color: theme.textStrong }}>
                          {row.full_name || '—'}
                        </div>
                        <div className="text-[11.5px]" style={{ color: theme.muted }}>{row.email}</div>
                      </Td>
                      <Td theme={theme} muted>{row.subscription_plan || '—'}</Td>
                      <Td theme={theme}>
                        <StatusPill
                          status={row.subscription_status || '—'}
                          tone={row.subscription_status === 'past_due' ? 'err' : 'warn'}
                          theme={theme}
                        />
                      </Td>
                      <Td theme={theme} muted>{fmtDate(row.current_period_end)}</Td>
                      <Td theme={theme}>{row.cancel_at_period_end ? 'Yes' : 'No'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Tab: Payouts
// -----------------------------------------------------------------------
function PayoutsTab({ data, theme }) {
  const s = data.stripe;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="grid grid-cols-1 gap-3 lg:col-span-1">
        <Kpi
          label="Stripe available"
          value={s.available === null ? '—' : fmtCents(s.available)}
          hint="Ready for next payout"
          theme={theme}
          accent="rev"
        />
        <Kpi
          label="Stripe pending"
          value={s.pending === null ? '—' : fmtCents(s.pending)}
          hint="Not yet available"
          theme={theme}
          accent="pos"
        />
        <Kpi
          label="Next payout"
          value={s.upcoming_payout ? fmtCents(s.upcoming_payout.amount_cents) : '—'}
          hint={
            s.upcoming_payout?.arrival_date
              ? `Arrives ${fmtDate(s.upcoming_payout.arrival_date)} · ${s.upcoming_payout.status}`
              : 'Nothing scheduled'
          }
          theme={theme}
        />
      </div>

      <div className="lg:col-span-2">
        <Panel title="Recent payouts" theme={theme}>
          {s.error && (
            <div
              className="rounded-lg p-3 mb-3 text-[13px]"
              style={{ background: theme.errBg, color: theme.err, border: `1px solid ${theme.err}` }}
            >
              Couldn’t reach Stripe: {s.error}
            </div>
          )}
          {(!s.recent_payouts || s.recent_payouts.length === 0) ? (
            <Empty theme={theme}>
              No payouts yet. Once Stripe pays out the available balance, they’ll appear here.
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr style={{ color: theme.muted }} className="text-[11px] uppercase tracking-[0.1em]">
                    <Th theme={theme}>Arrives</Th>
                    <Th theme={theme}>Status</Th>
                    <Th theme={theme}>Method</Th>
                    <Th theme={theme}>Description</Th>
                    <Th theme={theme} align="right">Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {s.recent_payouts.map((p) => (
                    <tr key={p.id} style={{ borderTop: `1px solid ${theme.rowBorder}` }}>
                      <Td theme={theme}>{fmtDate(p.arrival_date)}</Td>
                      <Td theme={theme}>
                        <StatusPill
                          status={p.status}
                          tone={p.status === 'paid' ? 'good' : p.status === 'failed' ? 'err' : 'neutral'}
                          theme={theme}
                        />
                      </Td>
                      <Td theme={theme} muted>{p.method || '—'}</Td>
                      <Td theme={theme} muted>{p.description || '—'}</Td>
                      <Td theme={theme} align="right" bold>{fmtCents(p.amount_cents)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Tiny primitives (Panel, Th, Td, Row, Empty)
// -----------------------------------------------------------------------
function Panel({ title, theme, children }) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}
    >
      <div
        className="px-5 py-3 text-[13px] font-bold uppercase tracking-[0.12em]"
        style={{ borderBottom: `1px solid ${theme.divider}`, color: theme.muted }}
      >
        {title}
      </div>
      <div className="p-2">{children}</div>
    </div>
  );
}
function Empty({ theme, children }) {
  return (
    <div className="p-6 text-center text-sm" style={{ color: theme.muted }}>
      {children}
    </div>
  );
}
function Th({ children, align = 'left', theme }) {
  return (
    <th
      className="px-4 py-2.5 font-bold text-[11px]"
      style={{ textAlign: align, borderBottom: `1px solid ${theme.divider}`, color: theme.muted }}
    >
      {children}
    </th>
  );
}
function Td({ children, align = 'left', bold, muted, tone, theme }) {
  const color = tone === 'rev' ? theme.rev
    : tone === 'warn' ? theme.warn
    : tone === 'err' ? theme.err
    : muted ? theme.muted
    : theme.text;
  return (
    <td
      className="px-4 py-2.5"
      style={{ textAlign: align, color, fontWeight: bold ? 700 : 400 }}
    >
      {children}
    </td>
  );
}
function Row({ label, value, tone, theme }) {
  const color = tone === 'warn' ? theme.warn : theme.textStrong;
  return (
    <div className="flex items-center justify-between">
      <dt style={{ color: theme.muted }}>{label}</dt>
      <dd className="font-semibold" style={{ color }}>{value}</dd>
    </div>
  );
}
