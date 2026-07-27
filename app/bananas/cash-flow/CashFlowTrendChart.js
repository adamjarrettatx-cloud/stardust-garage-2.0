'use client';

// Monthly inflow vs outflow, paired bars per month. Buckets are derived from
// the already-loaded ledger rows by lib/financial-ledger.monthlyTrend(), so
// nothing refetches. Visual language (gridlines, nice axis ceiling, hover
// tooltip) follows TicketTailorSalesChart on the Event Analytics page.

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

export default function CashFlowTrendChart({ buckets, t, months }) {
  const [hovered, setHovered] = useState(null);

  const axisMax = niceCeiling(Math.max(
    ...buckets.map((b) => Math.max(b.inflowCents, b.outflowCents)),
    0,
  ));
  const hasActivity = buckets.some((b) => b.inflowCents > 0 || b.outflowCents > 0);

  return (
    <section
      className="rounded-[14px] border p-5 mb-8"
      style={{ background: t.cardBg, borderColor: t.cardBorder }}
      data-testid="cash-flow-trend"
    >
      <h2
        className="text-[16px] font-extrabold"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}
      >
        Monthly cash trend
      </h2>
      <p className="text-[12px] mt-0.5 mb-4" style={{ color: t.muted }}>
        Last {months} months · all cash in vs out, financing included · transfers excluded
      </p>

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

            <div className="absolute inset-0 flex items-end gap-[6px]">
              {buckets.map((b, i) => {
                const isHovered = hovered === i;
                return (
                  <div
                    key={b.key}
                    className="flex-1 h-full flex items-end gap-[2px] min-w-0 relative"
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(i)}
                    onBlur={() => setHovered(null)}
                    tabIndex={0}
                    role="img"
                    aria-label={`${b.tooltipLabel}: ${centsToUsd(b.inflowCents)} in, ${centsToUsd(b.outflowCents)} out`}
                  >
                    {[
                      { cents: b.inflowCents, color: t.rev },
                      { cents: b.outflowCents, color: t.warn },
                    ].map((bar, barIndex) => (
                      <div
                        key={barIndex}
                        className="flex-1 rounded-t-[2px] transition-opacity"
                        style={{
                          // A 1px sliver for an empty bucket keeps the axis
                          // reading as a continuous timeline rather than a gap.
                          height: bar.cents > 0 ? `max(${(bar.cents / axisMax) * 100}%, 2px)` : '1px',
                          background: bar.cents > 0 ? bar.color : t.rowBorder,
                          opacity: hovered == null || isHovered ? 1 : 0.45,
                        }}
                      />
                    ))}

                    {isHovered && (
                      <div
                        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-10 whitespace-nowrap rounded-[8px] border px-2.5 py-1.5 pointer-events-none"
                        style={{ background: t.cardBg, borderColor: t.cardBorder, boxShadow: '0 6px 20px rgba(0,0,0,0.35)' }}
                      >
                        <div className="text-[11px] font-semibold" style={{ color: t.textStrong }}>{b.tooltipLabel}</div>
                        <div className="text-[12px] font-extrabold" style={{ color: t.rev }}>In {centsToUsd(b.inflowCents)}</div>
                        <div className="text-[12px] font-extrabold" style={{ color: t.warn }}>Out {centsToUsd(b.outflowCents)}</div>
                        <div className="text-[10px]" style={{ color: t.muted }}>Net {centsToUsd(b.netCents)}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-[6px] mt-1.5">
            {buckets.map((b) => (
              <div key={b.key} className="flex-1 min-w-0 text-[9px] text-center leading-tight" style={{ color: t.faint }}>
                {b.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {!hasActivity && (
        <p className="text-[12px] mt-4" style={{ color: t.muted }}>
          No ledger activity in this window yet. Run a TicketTailor sync or import a SpotOn CSV above.
        </p>
      )}
    </section>
  );
}
