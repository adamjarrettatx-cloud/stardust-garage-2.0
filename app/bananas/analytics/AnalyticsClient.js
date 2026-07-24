'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { centsToUsd } from '@/lib/event-analytics';
import ThemeToggle from '@/app/components/ThemeToggle';
import { ANALYTICS_THEMES as THEMES, ANALYTICS_THEME_KEY as THEME_KEY } from '@/lib/admin-theme';
import RefreshMetricsButton from './RefreshMetricsButton';
import RowRefreshButton from './RowRefreshButton';

const CATEGORY_COLOR = {
  workshop: '#ffb84d', yoga: '#4ade80', party: '#f472b6', other: '#8a8a8a',
};

function fmtDate(s) {
  if (!s) return '—';
  return new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtFetched(iso) {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function AnalyticsClient({ rows, totals, lastFetched, hasAnyMetrics }) {
  const [theme, setTheme] = useState('dark');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch {
      // localStorage unavailable — fall back to default dark theme silently.
    }
  }, []);
  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try { window.localStorage.setItem(THEME_KEY, next); } catch {}
      return next;
    });
  };
  const t = THEMES[theme];

  const gridCols = 'grid-cols-[1fr_100px_90px_90px_70px_70px_80px]';

  return (
    <main
      className="max-w-[1100px] mx-auto px-6 py-16 my-6 md:my-10 rounded-[28px] transition-colors duration-150"
      style={{ background: t.panelBg || 'transparent', boxShadow: t.panelShadow, color: t.text }}
      data-testid="event-analytics"
    >
      <Link
        href="/bananas"
        className="text-[12px] tracking-[0.14em] mb-4 inline-block transition-opacity hover:opacity-70"
        style={{ color: t.muted }}
      >
        ← BACK TO ADMIN
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
        <h1
          className="text-[32px] font-extrabold -tracking-[0.02em] leading-[1.1]"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}
        >
          Event Analytics
        </h1>
        <div className="flex items-center gap-3">
          <div className="text-[11px] tracking-[0.18em]" style={{ color: t.muted }}>
            OWNER ONLY
          </div>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </div>
      <p className="mb-6 text-[14px]" style={{ color: t.muted }}>
        Member-code engagement from local data plus cached TicketTailor sales metrics. Revenue figures come
        from the read-only metrics cache, refreshed on a daily cron or on demand below.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <RefreshMetricsButton />
        <span className="text-[12px]" style={{ color: t.muted }}>
          Metrics last fetched: <span style={{ color: t.mutedStrong }}>{fmtFetched(lastFetched)}</span>
        </span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Events', value: totals.events },
          { label: 'TT-linked events', value: totals.ttLinked },
          { label: 'Member codes', value: totals.memberCodes },
          { label: 'Codes sent', value: totals.codesSent },
        ].map((c) => (
          <div key={c.label} className="rounded-[14px] border p-5" style={{ background: t.cardBg, borderColor: t.cardBorder }}>
            <div className="text-[10px] font-semibold tracking-[0.14em] uppercase mb-1.5" style={{ color: t.muted }}>{c.label}</div>
            <div className="text-[28px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Revenue cards — only meaningful once metrics are cached. */}
      {hasAnyMetrics ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {[
            { label: 'Gross revenue', value: centsToUsd(totals.grossCents) },
            { label: 'Fees', value: centsToUsd(totals.feesCents) },
            { label: 'Net revenue', value: centsToUsd(totals.netCents) },
            { label: 'Tickets sold', value: totals.ticketsSold },
          ].map((c) => (
            <div key={c.label} className="rounded-[14px] border p-5" style={{ background: t.revCardBg, borderColor: t.revCardBorder }}>
              <div className="text-[10px] font-semibold tracking-[0.14em] uppercase mb-1.5" style={{ color: t.rev }}>{c.label}</div>
              <div className="text-[24px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}>{c.value}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[14px] border p-5 mb-10" style={{ background: t.warnCardBg, borderColor: t.warnCardBorder }}>
          <div className="text-[10px] font-semibold tracking-[0.14em] uppercase mb-2" style={{ color: t.warn }}>
            No cached TicketTailor metrics yet
          </div>
          <p className="text-[13px]" style={{ color: t.mutedStrong }}>
            Revenue, fees, net, and tickets-sold totals appear here once the read-only metrics cache is
            populated. Link an event to a TicketTailor series and click <strong>Refresh metrics</strong>, or
            wait for the daily cron. Events without a TT series, or environments without
            <code className="mx-1" style={{ color: t.textStrong }}>TICKETTAILOR_API_KEY</code>, are recorded as
            “not configured” rather than guessed.
          </p>
        </div>
      )}

      {/* Per-event table */}
      <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase mb-3" style={{ color: t.muted }}>
        Performance by event
      </h2>
      {rows.length === 0 ? (
        <p className="text-[13px]" style={{ color: t.muted }}>No events yet.</p>
      ) : (
        <div className="rounded-[12px] border overflow-hidden" style={{ background: t.cardBg, borderColor: t.cardBorder }}>
          <div className={`grid ${gridCols} gap-2 px-4 py-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase`} style={{ color: t.muted, borderBottom: `1px solid ${t.tableBorder}` }}>
            <span>Event</span><span>Date</span><span>Gross</span><span>Net</span><span>Sold</span><span>Codes</span><span>TT</span>
          </div>
          {rows.map((r) => {
            const m = r.metrics;
            // A refreshed event shows real figures (incl. a genuine $0.00 / 0);
            // an un-refreshed or not_configured event shows "—".
            const refreshed = m && m.refreshed;
            return (
              <div key={r.id} className={`grid ${gridCols} gap-2 px-4 py-3 text-[13px] items-center`} style={{ borderTop: `1px solid ${t.rowBorder}` }}>
                <span className="truncate flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: CATEGORY_COLOR[r.category] || t.muted }} />
                  <Link href={`/bananas/events/${r.id}`} className="truncate hover:underline" style={{ color: t.text }}>{r.title}</Link>
                </span>
                <span style={{ color: t.mutedStrong }}>{fmtDate(r.eventDate)}</span>
                <span style={{ color: refreshed ? t.grossText : t.faint }}>{refreshed ? centsToUsd(m.grossCents) : '—'}</span>
                <span style={{ color: refreshed ? t.rev : t.faint }}>{refreshed ? centsToUsd(m.netCents) : '—'}</span>
                <span style={{ color: refreshed ? t.grossText : t.faint }}>{refreshed ? m.ticketsSold : '—'}</span>
                <span style={{ color: t.text }} title={`${r.memberCodes.sent} sent / ${r.memberCodes.total} total`}>
                  {r.memberCodes.sent}/{r.memberCodes.total}
                </span>
                {r.ttSeriesLinked ? (
                  <span className="flex items-center gap-1.5">
                    <span style={{ color: t.rev }}>linked</span>
                    <RowRefreshButton eventId={r.id} />
                  </span>
                ) : (
                  <Link
                    href={`/bananas/events/${r.id}`}
                    className="hover:underline"
                    style={{ color: t.warn }}
                    title="Link this event to a TicketTailor series"
                  >
                    Link →
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-[12px]" style={{ color: t.faint }}>
        Codes column shows member discount codes sent / generated for the event. Revenue columns are blank
        until the event is TT-linked and its metrics have been refreshed.
      </p>
    </main>
  );
}
