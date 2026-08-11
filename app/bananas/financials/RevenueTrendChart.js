'use client';

// Day/week/month revenue trend — stacked bars (named-event revenue at the
// base, SpotOn point-of-sale revenue stacked on top) so a single glance shows
// both how much money came in and where it came from. Buckets are produced
// by lib/financial-overview.rollupDailyRevenue(); this component only draws.
// Visual language (gridlines, nice axis ceiling, hover tooltip) mirrors
// CashFlowTrendChart on the Cash Flow page so the two owner-only financial
// surfaces read as one family.

import { useState } from 'react';
import { centsToUsd } from '@/lib/event-analytics';

const GRID_LINES = 4;

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

const GRANULARITY_WINDOW_LABEL = {
  day: 'Every calendar day with income',
  week: 'ISO weeks (Mon–Sun)',
  month: 'Calendar months',
};

export default function RevenueTrendChart({ buckets, t, granularity }) {
  const [hovered, setHovered] = useState(null);

  const axisMax = niceCeiling(Math.max(...buckets.map((b) => b.totalGrossCents), 0));
  const hasActivity = buckets.some((b) => b.totalGrossCents > 0 || b.posRefundCents > 0);

  return (
    <section
      className="rounded-[14px] border p-5 mb-6"
      style={{ background: t.cardBg, borderColor: t.cardBorder }}
      data-testid="revenue-trend-chart"
    >
      <h2
        className="text-[16px] font-extrabold"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}
      >
        Revenue trend
      </h2>
      <p className="text-[12px] mt-0.5 mb-4" style={{ color: t.muted }}>
        {GRANULARITY_WINDOW_LABEL[granularity]} · event income (
        <span style={{ color: t.rev }}>green</span>) stacked with SpotOn point-of-sale income (
        <span style={{ color: t.pos }}>blue</span>)
      </p>

      {buckets.length === 0 ? (
        <p className="text-[12px]" style={{ color: t.muted }}>No revenue recorded yet.</p>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="flex flex-col justify-between h-[200px] text-[10px] text-right shrink-0 w-12" style={{ color: t.muted }}>
              {Array.from({ length: GRID_LINES + 1 }, (_, i) => (
                <span key={i} className="leading-none">{axisMoney((axisMax * (GRID_LINES - i)) / GRID_LINES)}</span>
              ))}
            </div>

            <div className="flex-1 min-w-0">
              <div className="relative h-[200px]">
                {Array.from({ length: GRID_LINES + 1 }, (_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-t"
                    style={{ top: `${(i / GRID_LINES) * 100}%`, borderColor: t.rowBorder }}
                  />
                ))}

                <div className="absolute inset-0 flex items-end gap-[3px]">
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
                        aria-label={`${b.tooltipLabel}: ${centsToUsd(b.eventGrossCents)} event, ${centsToUsd(b.posRevenueCents)} POS`}
                      >
                        <div
                          className="w-full rounded-t-[2px] overflow-hidden transition-opacity"
                          style={{
                            // A 1px sliver for an empty bucket keeps the axis
                            // reading as a continuous timeline rather than a gap.
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
                            <div className="text-[12px] font-extrabold" style={{ color: t.rev }}>Event {centsToUsd(b.eventGrossCents)}</div>
                            <div className="text-[12px] font-extrabold" style={{ color: t.pos }}>POS {centsToUsd(b.posRevenueCents)}</div>
                            {b.posRefundCents > 0 && (
                              <div className="text-[11px]" style={{ color: t.warn }}>POS refunds −{centsToUsd(b.posRefundCents)}</div>
                            )}
                            <div className="text-[12px] font-extrabold mt-0.5 pt-0.5" style={{ color: t.textStrong, borderTop: `1px solid ${t.rowBorder}` }}>Total {centsToUsd(b.totalGrossCents)}</div>
                            <div className="text-[10px]" style={{ color: t.muted }}>Net {centsToUsd(b.totalNetCents)}</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-[3px] mt-1.5">
                {buckets.map((b) => (
                  <div key={b.key} className="flex-1 min-w-0 text-[9px] text-center leading-tight truncate" style={{ color: t.faint }} title={b.tooltipLabel}>
                    {b.label}
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
