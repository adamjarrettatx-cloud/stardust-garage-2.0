'use client';

// Macro "everything in one place" view for the very top of the Financials
// page: total revenue across BOTH TicketTailor (event/ticket income) and
// SpotOn (point-of-sale income), stacked into a single bar per day/week/
// month so a glance answers "how is the business doing overall" without
// picking a tab first. Buckets are produced by the same
// lib/financial-overview.rollupDailyRevenue() the Trends tab already uses —
// this card just surfaces that rollup unconditionally at the top of the page
// with its own granularity toggle, independent of whichever tab is active.
//
// Visual language borrows the header/toggle-pill layout from
// TicketTailorSalesChart (title + window subtitle left, By day/week/month
// pills right, big $ headline) and the stacked-bar body from
// RevenueTrendChart (event revenue green, SpotOn POS revenue blue).

import { useMemo, useState } from 'react';
import { centsToUsd } from '@/lib/event-analytics';
import { rollupDailyRevenue } from '@/lib/financial-overview';

const TABS = [
  { id: 'day', label: 'By day' },
  { id: 'week', label: 'By week' },
  { id: 'month', label: 'By month' },
];

const GRID_LINES = 4;
const MAX_AXIS_LABELS = 12;

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

export default function TotalSalesChart({ dailyRevenue, t }) {
  const [granularity, setGranularity] = useState('month');
  const [hovered, setHovered] = useState(null);

  const buckets = useMemo(() => rollupDailyRevenue(dailyRevenue, granularity), [dailyRevenue, granularity]);

  const rangeEventGross = useMemo(() => buckets.reduce((sum, b) => sum + b.eventGrossCents, 0), [buckets]);
  const rangePosRevenue = useMemo(() => buckets.reduce((sum, b) => sum + b.posRevenueCents, 0), [buckets]);
  const rangeTotalGross = useMemo(() => buckets.reduce((sum, b) => sum + b.totalGrossCents, 0), [buckets]);
  const daysWithIncome = useMemo(() => buckets.reduce((sum, b) => sum + (b.totalGrossCents > 0 ? (b.days || 1) : 0), 0), [buckets]);

  const axisMax = niceCeiling(Math.max(...buckets.map((b) => b.totalGrossCents), 0));
  const hasActivity = buckets.some((b) => b.totalGrossCents > 0);
  const labelEvery = Math.ceil(buckets.length / MAX_AXIS_LABELS) || 1;

  return (
    <section
      className="rounded-[14px] border p-5 mb-8"
      style={{ background: t.cardBg, borderColor: t.cardBorder }}
      data-testid="total-sales-chart"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <div>
          <h2
            className="text-[16px] font-extrabold"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}
          >
            Total sales — TicketTailor + SpotOn
          </h2>
          <p className="text-[12px] mt-0.5" style={{ color: t.muted }}>
            Every revenue source, one bar per {granularity} · the macro view of the whole business at a glance
          </p>
        </div>

        <div className="flex rounded-[10px] border overflow-hidden" role="tablist" aria-label="Total sales chart granularity">
          {TABS.map((tab) => {
            const active = tab.id === granularity;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => { setGranularity(tab.id); setHovered(null); }}
                data-testid={`total-sales-granularity-${tab.id}`}
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

      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 mb-2">
        <span className="text-[26px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}>
          {centsToUsd(rangeTotalGross)}
        </span>
        <span className="text-[12px]" style={{ color: t.muted }}>
          across {daysWithIncome} {daysWithIncome === 1 ? 'day' : 'days'} with recorded income in this window
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-5 text-[12px]">
        <span className="flex items-center gap-1.5" style={{ color: t.mutedStrong }}>
          <span className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ background: t.rev }} />
          TicketTailor / event: {centsToUsd(rangeEventGross)}
        </span>
        <span className="flex items-center gap-1.5" style={{ color: t.mutedStrong }}>
          <span className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ background: t.pos }} />
          SpotOn POS: {centsToUsd(rangePosRevenue)}
        </span>
      </div>

      {buckets.length === 0 ? (
        <p className="text-[12px]" style={{ color: t.muted }}>No revenue recorded yet.</p>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="flex flex-col justify-between h-[220px] text-[10px] text-right shrink-0 w-12" style={{ color: t.muted }}>
              {Array.from({ length: GRID_LINES + 1 }, (_, i) => (
                <span key={i} className="leading-none">{axisMoney((axisMax * (GRID_LINES - i)) / GRID_LINES)}</span>
              ))}
            </div>

            <div className="flex-1 min-w-0">
              <div className="relative h-[220px]">
                {Array.from({ length: GRID_LINES + 1 }, (_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-t"
                    style={{ top: `${(i / GRID_LINES) * 100}%`, borderColor: t.rowBorder }}
                  />
                ))}

                <div className="absolute inset-0 flex items-end gap-[2px]">
                  {buckets.map((b, i) => {
                    const isHovered = hovered === i;
                    const eventPct = axisMax > 0 ? (b.eventGrossCents / axisMax) * 100 : 0;
                    const posPct = axisMax > 0 ? (b.posRevenueCents / axisMax) * 100 : 0;
                    const isEmpty = b.totalGrossCents <= 0;
                    return (
                      <div
                        key={b.key}
                        className="flex-1 h-full min-w-0 relative flex flex-col justify-end"
                        onMouseEnter={() => setHovered(i)}
                        onMouseLeave={() => setHovered(null)}
                        onFocus={() => setHovered(i)}
                        onBlur={() => setHovered(null)}
                        tabIndex={0}
                        role="img"
                        aria-label={`${b.tooltipLabel}: ${centsToUsd(b.totalGrossCents)} total (${centsToUsd(b.eventGrossCents)} TicketTailor, ${centsToUsd(b.posRevenueCents)} SpotOn)`}
                      >
                        <div
                          className="w-full rounded-t-[2px] overflow-hidden transition-opacity"
                          style={{
                            height: isEmpty ? '1px' : `max(${eventPct + posPct}%, 2px)`,
                            background: isEmpty ? t.rowBorder : undefined,
                            opacity: hovered == null || isHovered ? 1 : 0.45,
                          }}
                        >
                          {!isEmpty && (
                            <div className="w-full h-full flex flex-col justify-end">
                              <div style={{ height: `${(posPct / (eventPct + posPct || 1)) * 100}%`, background: t.pos, minHeight: b.posRevenueCents > 0 ? '2px' : 0 }} />
                              <div style={{ height: `${(eventPct / (eventPct + posPct || 1)) * 100}%`, background: t.rev, minHeight: b.eventGrossCents > 0 ? '2px' : 0 }} />
                            </div>
                          )}
                        </div>

                        {isHovered && (
                          <div
                            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-10 whitespace-nowrap rounded-[8px] border px-2.5 py-1.5 pointer-events-none"
                            style={{ background: t.cardBg, borderColor: t.cardBorder, boxShadow: '0 6px 20px rgba(0,0,0,0.35)' }}
                          >
                            <div className="text-[11px] font-semibold" style={{ color: t.textStrong }}>{b.tooltipLabel}</div>
                            <div className="text-[12px] font-extrabold" style={{ color: t.rev }}>TicketTailor {centsToUsd(b.eventGrossCents)}</div>
                            <div className="text-[12px] font-extrabold" style={{ color: t.pos }}>SpotOn {centsToUsd(b.posRevenueCents)}</div>
                            {b.posRefundCents > 0 && (
                              <div className="text-[11px]" style={{ color: t.warn }}>SpotOn refunds −{centsToUsd(b.posRefundCents)}</div>
                            )}
                            <div className="text-[12px] font-extrabold mt-0.5 pt-0.5" style={{ color: t.textStrong, borderTop: `1px solid ${t.rowBorder}` }}>Total {centsToUsd(b.totalGrossCents)}</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-[2px] mt-1.5">
                {buckets.map((b, i) => (
                  <div key={b.key} className="flex-1 min-w-0 text-[9px] text-center leading-tight truncate" style={{ color: t.faint }} title={b.tooltipLabel}>
                    {i % labelEvery === 0 ? b.label : ''}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {!hasActivity && (
            <p className="text-[12px] mt-4" style={{ color: t.muted }}>
              No income recorded in this window yet.
            </p>
          )}
        </>
      )}
    </section>
  );
}
