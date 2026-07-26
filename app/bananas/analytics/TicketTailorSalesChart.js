'use client';

// TicketTailor ticket-sales revenue over time, bucketed by venue-local
// (America/Chicago) day / ISO week (Monday start) / month. Series are
// precomputed server-side in lib/ticket-sales-timeseries.js from
// public.ticket_order_attribution, so switching tabs never refetches.
//
// TODO: future POS CSV upload data will also need to be merged into this
// chart's totals. lib/ticket-sales-timeseries.js buckets a single source today;
// a POS importer should add its own per-bucket contribution the same way
// lib/financial-calendar.js's mergeIncomeSources() layers income providers.

import { useMemo, useState } from 'react';
import { centsToUsd } from '@/lib/event-analytics';
import { summarizeSeries } from '@/lib/ticket-sales-timeseries';

const TABS = [
  { id: 'day', label: 'By day', window: 'Last 30 days' },
  { id: 'week', label: 'By week', window: 'Last 12 weeks (weeks start Monday)' },
  { id: 'month', label: 'By month', window: 'Last 12 months' },
];

const GRID_LINES = 4;
const MAX_AXIS_LABELS = 12;

// Round the axis maximum up to a clean 1/2/5 x 10^n step so gridline labels are
// readable dollar amounts rather than arbitrary fractions of the tallest bar.
function niceCeiling(maxCents) {
  if (maxCents <= 0) return 100;
  const step = Math.pow(10, Math.floor(Math.log10(maxCents)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (maxCents <= step * m) return step * m;
  }
  return step * 10;
}

function axisMoney(cents) {
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${(dollars / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
  return `$${dollars.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export default function TicketTailorSalesChart({ series, t }) {
  const [granularity, setGranularity] = useState('day');
  const [hovered, setHovered] = useState(null);

  const buckets = useMemo(() => series?.[granularity] || [], [series, granularity]);
  const totals = useMemo(() => summarizeSeries(buckets), [buckets]);

  const activeTab = TABS.find((tab) => tab.id === granularity);
  const axisMax = niceCeiling(Math.max(...buckets.map((b) => b.grossCents), 0));
  const hasSales = totals.grossCents > 0;

  // Thin x-axis labels on dense views so they stay legible instead of colliding.
  const labelEvery = Math.ceil(buckets.length / MAX_AXIS_LABELS) || 1;

  return (
    <section
      className="rounded-[14px] border p-5 mb-8"
      style={{ background: t.cardBg, borderColor: t.cardBorder }}
      data-testid="tt-sales-chart"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <div>
          <h2
            className="text-[16px] font-extrabold"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}
          >
            Ticket sales revenue
          </h2>
          <p className="text-[12px] mt-0.5" style={{ color: t.muted }}>
            {activeTab.window} · by order date · Austin time
          </p>
        </div>

        <div
          className="flex rounded-[10px] border overflow-hidden"
          role="tablist"
          aria-label="Sales chart granularity"
        >
          {TABS.map((tab) => {
            const active = tab.id === granularity;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => { setGranularity(tab.id); setHovered(null); }}
                className="px-3 py-1.5 text-[12px] font-semibold transition-colors"
                style={{
                  background: active ? t.revCardBg : 'transparent',
                  color: active ? t.rev : t.muted,
                  borderColor: t.cardBorder,
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 mb-5">
        <span className="text-[26px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}>
          {centsToUsd(totals.grossCents)}
        </span>
        <span className="text-[12px]" style={{ color: t.muted }}>
          {totals.ordersCount} completed {totals.ordersCount === 1 ? 'order' : 'orders'} in this window
        </span>
      </div>

      <div className="flex gap-2">
        {/* Y axis: revenue in dollars */}
        <div className="flex flex-col justify-between h-[220px] text-[10px] text-right shrink-0 w-12" style={{ color: t.muted }}>
          {Array.from({ length: GRID_LINES + 1 }, (_, i) => (
            <span key={i} className="leading-none">{axisMoney((axisMax * (GRID_LINES - i)) / GRID_LINES)}</span>
          ))}
        </div>

        <div className="flex-1 min-w-0">
          <div className="relative h-[220px]">
            {/* Horizontal gridlines */}
            {Array.from({ length: GRID_LINES + 1 }, (_, i) => (
              <div
                key={i}
                className="absolute left-0 right-0 border-t"
                style={{ top: `${(i / GRID_LINES) * 100}%`, borderColor: t.rowBorder }}
              />
            ))}

            <div className="absolute inset-0 flex items-end gap-[2px]">
              {buckets.map((b, i) => {
                const pct = axisMax > 0 ? (b.grossCents / axisMax) * 100 : 0;
                const isHovered = hovered === i;
                return (
                  <div
                    key={b.key}
                    className="flex-1 h-full flex items-end min-w-0 relative"
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(i)}
                    onBlur={() => setHovered(null)}
                    tabIndex={0}
                    role="img"
                    aria-label={`${b.tooltipLabel}: ${centsToUsd(b.grossCents)} from ${b.ordersCount} ${b.ordersCount === 1 ? 'order' : 'orders'}`}
                  >
                    <div
                      className="w-full rounded-t-[2px] transition-opacity"
                      style={{
                        // Keep a 1px sliver for empty buckets so the axis reads
                        // as a continuous timeline rather than a gap.
                        height: b.grossCents > 0 ? `max(${pct}%, 2px)` : '1px',
                        background: b.grossCents > 0 ? t.rev : t.rowBorder,
                        opacity: hovered == null || isHovered ? 1 : 0.45,
                      }}
                    />

                    {isHovered && (
                      <div
                        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-10 whitespace-nowrap rounded-[8px] border px-2.5 py-1.5 pointer-events-none"
                        style={{ background: t.cardBg, borderColor: t.cardBorder, boxShadow: '0 6px 20px rgba(0,0,0,0.35)' }}
                      >
                        <div className="text-[11px] font-semibold" style={{ color: t.textStrong }}>{b.tooltipLabel}</div>
                        <div className="text-[13px] font-extrabold" style={{ color: t.rev }}>{centsToUsd(b.grossCents)}</div>
                        <div className="text-[10px]" style={{ color: t.muted }}>
                          {b.ordersCount} {b.ordersCount === 1 ? 'order' : 'orders'}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* X axis: time */}
          <div className="flex gap-[2px] mt-1.5">
            {buckets.map((b, i) => (
              <div key={b.key} className="flex-1 min-w-0 text-[9px] text-center leading-tight" style={{ color: t.faint }}>
                {i % labelEvery === 0 ? b.label : ''}
              </div>
            ))}
          </div>
        </div>
      </div>

      {!hasSales && (
        <p className="text-[12px] mt-4" style={{ color: t.muted }}>
          No completed TicketTailor orders recorded in this window yet. Bars appear as the
          order webhook records sales into <code style={{ color: t.mutedStrong }}>ticket_order_attribution</code>.
        </p>
      )}
    </section>
  );
}
