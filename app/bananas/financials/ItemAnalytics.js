'use client';

// Item Sales tab — SpotOn point-of-sale line items, broken down five ways per
// Adam's request:
//   1. Top selling products (by item name, revenue-ranked)
//   2. Most popular times (transactions by hour) + top products per day-part
//   3. Total sold per item + how that item's popularity has moved over time
//   4. TicketTailor purchase lead time (how far ahead people buy tickets)
//   5. Every day's total sales since day one, on one screen, no scrolling
//
// Data comes from spoton_line_items via /api/admin/analytics/item-sales,
// which is itself built from public.spoton_line_items — see the migration at
// supabase/migrations/20260814_spoton_line_items.sql for the six read-only
// RPCs this page calls. Employee name exists in that table for traceability
// but is deliberately never rendered here (Adam's call).
//
// Visual language matches RevenueTrendChart / TicketTailorSalesChart on this
// same page: Plus Jakarta Sans headings, the shared `t` theme palette, hand
// rolled SVG-free bar charts (divs, not <svg>) with hover tooltips.

import { useEffect, useMemo, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

const GRID_LINES = 4;

function niceCeiling(max) {
  if (max <= 0) return 10;
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (max <= step * m) return step * m;
  }
  return step * 10;
}

function axisMoney(cents) {
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${(dollars / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
  return `$${dollars.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function usd(cents) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function hourLabel(h) {
  if (h === 0) return '12a';
  if (h === 12) return '12p';
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

function fmtWeek(dateStr) {
  if (!dateStr) return '';
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDay(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

// -----------------------------------------------------------------------
// Section: card shell (matches RevenueTrendChart's <section> wrapper)
// -----------------------------------------------------------------------
function Card({ t, title, subtitle, children, testId }) {
  return (
    <section
      className="rounded-[14px] border p-5 mb-6"
      style={{ background: t.cardBg, borderColor: t.cardBorder }}
      data-testid={testId}
    >
      <h2 className="text-[16px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}>
        {title}
      </h2>
      {subtitle && (
        <p className="text-[12px] mt-0.5 mb-4" style={{ color: t.muted }}>{subtitle}</p>
      )}
      {!subtitle && <div className="mb-4" />}
      {children}
    </section>
  );
}

// -----------------------------------------------------------------------
// 1. Top selling products
// -----------------------------------------------------------------------
function TopItemsCard({ t, topItemsByName, topItemsByKey, fragmentedNames }) {
  const [groupBy, setGroupBy] = useState('name');
  const rows = (groupBy === 'name' ? topItemsByName : topItemsByKey).slice(0, 15);
  const maxNet = Math.max(...rows.map((r) => r.total_net_cents), 1);

  return (
    <Card
      t={t}
      title="Top selling products"
      subtitle="Ranked by net revenue · SpotOn POS line items, voids excluded"
      testId="item-analytics-top-items"
    >
      <div className="flex items-center gap-1 rounded-full border p-1 w-fit mb-4" style={{ borderColor: t.border || t.cardBorder }}>
        {[{ id: 'name', label: 'By item name' }, { id: 'key', label: 'By SpotOn menu ID' }].map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setGroupBy(opt.id)}
            data-testid={`item-analytics-groupby-${opt.id}`}
            className="px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-[0.06em] uppercase transition-colors"
            style={{
              background: groupBy === opt.id ? t.rev : 'transparent',
              color: groupBy === opt.id ? (t.addBtnText || '#0a0a0a') : t.mutedStrong,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {fragmentedNames?.length > 0 && groupBy === 'key' && (
        <p className="text-[11px] mb-3 rounded-[8px] px-3 py-2" style={{ color: t.warn, background: t.warnCardBg, border: `1px solid ${t.warnCardBorder}` }}>
          {fragmentedNames.length} item name{fragmentedNames.length === 1 ? '' : 's'} (e.g. {fragmentedNames.slice(0, 3).join(', ')}) are split across more than one SpotOn menu ID —
          switch to &ldquo;By item name&rdquo; for the true combined ranking.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-[12px]" style={{ color: t.muted }}>No item-level sales recorded yet.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((r, i) => (
            <div key={groupBy === 'name' ? r.item_name : r.product_key} className="flex items-center gap-3" data-testid="item-analytics-top-item-row">
              <span className="text-[11px] w-5 text-right shrink-0" style={{ color: t.faint }}>{i + 1}</span>
              <span className="text-[13px] w-40 md:w-56 shrink-0 truncate" style={{ color: t.textStrong }} title={r.item_name}>
                {r.item_name}
              </span>
              <div className="flex-1 h-6 rounded-[4px] overflow-hidden" style={{ background: t.rowBorder }}>
                <div
                  className="h-full rounded-[4px]"
                  style={{ width: `${Math.max((r.total_net_cents / maxNet) * 100, 2)}%`, background: t.rev }}
                />
              </div>
              <span className="text-[13px] font-bold w-20 text-right shrink-0" style={{ color: t.rev }}>{usd(r.total_net_cents)}</span>
              <span className="text-[11px] w-16 text-right shrink-0" style={{ color: t.muted }}>{Math.round(r.total_quantity)} sold</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// -----------------------------------------------------------------------
// 2. Most popular times (by hour) + top items per day-part
// -----------------------------------------------------------------------
function PopularTimesCard({ t, salesByHour, topItemsByDaypart }) {
  const [hovered, setHovered] = useState(null);
  const hours = Array.from({ length: 24 }, (_, h) => salesByHour.find((r) => r.hour_of_day === h) || { hour_of_day: h, order_count: 0, line_item_count: 0, total_net_cents: 0 });
  const maxOrders = Math.max(...hours.map((h) => Number(h.order_count) || 0), 1);

  const daypartGroups = topItemsByDaypart.reduce((acc, row) => {
    (acc[row.day_part] ||= []).push(row);
    return acc;
  }, {});

  return (
    <Card
      t={t}
      title="Most popular times"
      subtitle="Transactions by hour of day, and the top products people buy at each part of the day"
      testId="item-analytics-popular-times"
    >
      {hours.every((h) => h.order_count === 0) ? (
        <p className="text-[12px]" style={{ color: t.muted }}>No time-of-sale data yet.</p>
      ) : (
        <>
          <div className="relative h-[140px] flex items-end gap-[3px] mb-1.5">
            {hours.map((h) => {
              const isHovered = hovered === h.hour_of_day;
              const pct = (Number(h.order_count) / maxOrders) * 100;
              return (
                <div
                  key={h.hour_of_day}
                  className="flex-1 h-full relative flex flex-col justify-end"
                  onMouseEnter={() => setHovered(h.hour_of_day)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <div
                    className="w-full rounded-t-[2px] transition-opacity"
                    style={{
                      height: `max(${pct}%, 2px)`,
                      background: t.pos,
                      opacity: hovered == null || isHovered ? 1 : 0.4,
                    }}
                  />
                  {isHovered && (
                    <div
                      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-10 whitespace-nowrap rounded-[8px] border px-2.5 py-1.5 pointer-events-none"
                      style={{ background: t.cardBg, borderColor: t.cardBorder, boxShadow: '0 6px 20px rgba(0,0,0,0.35)' }}
                    >
                      <div className="text-[11px] font-semibold" style={{ color: t.textStrong }}>{hourLabel(h.hour_of_day)}</div>
                      <div className="text-[12px] font-extrabold" style={{ color: t.pos }}>{h.order_count} orders</div>
                      <div className="text-[11px]" style={{ color: t.muted }}>{usd(h.total_net_cents)}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex gap-[3px] mb-6">
            {hours.map((h) => (
              <span key={h.hour_of_day} className="flex-1 text-center text-[9px]" style={{ color: t.faint }}>
                {h.hour_of_day % 3 === 0 ? hourLabel(h.hour_of_day) : ''}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {Object.entries(daypartGroups).map(([daypart, items]) => (
              <div key={daypart} className="rounded-[10px] border p-3.5" style={{ borderColor: t.rowBorder }}>
                <div className="text-[10px] font-semibold tracking-[0.1em] uppercase mb-2" style={{ color: t.muted }}>{daypart}</div>
                <ol className="flex flex-col gap-1.5">
                  {items.map((it) => (
                    <li key={it.item_name} className="flex items-center justify-between text-[12px]">
                      <span className="truncate" style={{ color: t.textStrong }} title={it.item_name}>{it.item_name}</span>
                      <span className="shrink-0 ml-2" style={{ color: t.muted }}>{Math.round(it.total_quantity)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// -----------------------------------------------------------------------
// 3. Item trend — pick an item, see whether it's catching on or flat
// -----------------------------------------------------------------------
function ItemTrendCard({ t, itemCatalog, topItemsByName }) {
  const [selected, setSelected] = useState(itemCatalog[0]?.item_name || '');
  const [trend, setTrend] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminFetch(`/api/admin/analytics/item-sales?trend=${encodeURIComponent(selected)}`)
      .then((data) => { if (!cancelled) setTrend(data); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected]);

  const totals = topItemsByName.find((r) => r.item_name === selected);
  const weeks = trend?.weeks || [];
  const maxQty = Math.max(...weeks.map((w) => w.total_quantity), 1);

  return (
    <Card
      t={t}
      title="Is it catching on, or flat?"
      subtitle="Weekly quantity sold for one product, all-time — pick anything from the menu"
      testId="item-analytics-trend"
    >
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          data-testid="item-analytics-trend-select"
          className="text-[13px] rounded-[8px] border px-3 py-2"
          style={{ background: t.inputBg || t.cardBg, borderColor: t.inputBorder || t.cardBorder, color: t.inputText || t.textStrong }}
        >
          {itemCatalog.map((it) => (
            <option key={it.item_name} value={it.item_name}>{it.item_name}</option>
          ))}
        </select>
        {totals && (
          <span className="text-[12px]" style={{ color: t.muted }}>
            All-time: <span style={{ color: t.rev, fontWeight: 700 }}>{Math.round(totals.total_quantity)} sold</span> · {usd(totals.total_net_cents)}
          </span>
        )}
      </div>

      {loading && <p className="text-[12px]" style={{ color: t.muted }}>Loading trend…</p>}
      {error && <p className="text-[12px]" style={{ color: t.err || t.warn }}>{error}</p>}

      {!loading && !error && weeks.length > 0 && (
        <div className="relative h-[160px] flex items-end gap-[3px]">
          {weeks.map((w, i) => {
            const isHovered = hovered === i;
            const pct = (w.total_quantity / maxQty) * 100;
            return (
              <div
                key={w.week_start}
                className="flex-1 h-full relative flex flex-col justify-end"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              >
                <div
                  className="w-full rounded-t-[2px]"
                  style={{ height: `max(${pct}%, 2px)`, background: t.rev, opacity: hovered == null || isHovered ? 1 : 0.4 }}
                />
                {isHovered && (
                  <div
                    className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-10 whitespace-nowrap rounded-[8px] border px-2.5 py-1.5 pointer-events-none"
                    style={{ background: t.cardBg, borderColor: t.cardBorder, boxShadow: '0 6px 20px rgba(0,0,0,0.35)' }}
                  >
                    <div className="text-[11px] font-semibold" style={{ color: t.textStrong }}>Week of {fmtWeek(w.week_start)}</div>
                    <div className="text-[12px] font-extrabold" style={{ color: t.rev }}>{Math.round(w.total_quantity)} sold</div>
                    <div className="text-[11px]" style={{ color: t.muted }}>{usd(w.total_net_cents)}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!loading && !error && weeks.length === 0 && (
        <p className="text-[12px]" style={{ color: t.muted }}>No sales recorded for this item yet.</p>
      )}
      {weeks.length > 1 && (
        <p className="text-[11px] mt-2" style={{ color: t.faint }}>
          First week {fmtWeek(weeks[0].week_start)} → most recent {fmtWeek(weeks[weeks.length - 1].week_start)}. A rising line
          means it&rsquo;s becoming more popular over time; flat means demand hasn&rsquo;t moved.
        </p>
      )}
    </Card>
  );
}

// -----------------------------------------------------------------------
// 4. TicketTailor purchase lead time
// -----------------------------------------------------------------------
function LeadTimeCard({ t, ticketTailorLeadTime }) {
  const [hovered, setHovered] = useState(null);
  const total = ticketTailorLeadTime.reduce((s, r) => s + Number(r.order_count), 0);
  const maxCount = Math.max(...ticketTailorLeadTime.map((r) => Number(r.order_count)), 1);
  const dataIssue = ticketTailorLeadTime.find((r) => r.lead_bucket === 'After event (data issue)');

  return (
    <Card
      t={t}
      title="TicketTailor purchase lead time"
      subtitle="How far ahead of an event people buy their ticket"
      testId="item-analytics-lead-time"
    >
      {ticketTailorLeadTime.length === 0 ? (
        <p className="text-[12px]" style={{ color: t.muted }}>No TicketTailor order data yet.</p>
      ) : (
        <>
          <div className="flex items-end gap-3 h-[150px] mb-2">
            {ticketTailorLeadTime.map((r, i) => {
              const isIssue = r.lead_bucket === 'After event (data issue)';
              const isHovered = hovered === i;
              const pct = (Number(r.order_count) / maxCount) * 100;
              return (
                <div
                  key={r.lead_bucket}
                  className="flex-1 h-full relative flex flex-col justify-end items-center"
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span className="text-[11px] font-bold mb-1" style={{ color: isIssue ? t.warn : t.textStrong }}>{r.order_count}</span>
                  <div
                    className="w-full rounded-t-[3px]"
                    style={{ height: `max(${pct}%, 3px)`, background: isIssue ? t.warn : t.pos, opacity: hovered == null || isHovered ? 1 : 0.5 }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex gap-3">
            {ticketTailorLeadTime.map((r) => (
              <span key={r.lead_bucket} className="flex-1 text-center text-[10px] leading-tight" style={{ color: r.lead_bucket === 'After event (data issue)' ? t.warn : t.faint }}>
                {r.lead_bucket}
              </span>
            ))}
          </div>
          <p className="text-[11px] mt-4" style={{ color: t.muted }}>
            {total.toLocaleString('en-US')} completed orders analyzed.
            {dataIssue && Number(dataIssue.order_count) > 0 && (
              <> <span style={{ color: t.warn }}>{dataIssue.order_count} orders</span> show a purchase timestamp after the event&rsquo;s start — likely walk-up sales logged late or a timezone mismatch in that data; worth a closer look separately.</>
            )}
          </p>
        </>
      )}
    </Card>
  );
}

// -----------------------------------------------------------------------
// 5. All-time daily sales — single screen, every day since day one
// -----------------------------------------------------------------------
function AllTimeDailySalesCard({ t, dailySales }) {
  const [hovered, setHovered] = useState(null);
  const axisMax = niceCeiling(Math.max(...dailySales.map((d) => Number(d.total_net_cents)), 0));

  return (
    <Card
      t={t}
      title="Every day of POS sales, since day one"
      subtitle={dailySales.length > 0 ? `${dailySales.length} days · ${fmtDay(dailySales[0].business_date)} → ${fmtDay(dailySales[dailySales.length - 1].business_date)}` : undefined}
      testId="item-analytics-all-time-daily"
    >
      {dailySales.length === 0 ? (
        <p className="text-[12px]" style={{ color: t.muted }}>No daily sales recorded yet.</p>
      ) : (
        <div className="flex gap-2">
          <div className="flex flex-col justify-between h-[220px] text-[10px] text-right shrink-0 w-12" style={{ color: t.muted }}>
            {Array.from({ length: GRID_LINES + 1 }, (_, i) => (
              <span key={i} className="leading-none">{axisMoney((axisMax * (GRID_LINES - i)) / GRID_LINES)}</span>
            ))}
          </div>
          <div className="flex-1 min-w-0 relative h-[220px]">
            {Array.from({ length: GRID_LINES + 1 }, (_, i) => (
              <div key={i} className="absolute left-0 right-0 border-t" style={{ top: `${(i / GRID_LINES) * 100}%`, borderColor: t.rowBorder }} />
            ))}
            <div className="absolute inset-0 flex items-end gap-px">
              {dailySales.map((d, i) => {
                const isHovered = hovered === i;
                const pct = axisMax > 0 ? (Number(d.total_net_cents) / axisMax) * 100 : 0;
                return (
                  <div
                    key={d.business_date}
                    className="flex-1 h-full min-w-0 relative flex flex-col justify-end"
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <div
                      className="w-full rounded-t-[1px]"
                      style={{ height: `max(${pct}%, 1px)`, background: t.rev, opacity: hovered == null || isHovered ? 1 : 0.55 }}
                    />
                    {isHovered && (
                      <div
                        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-10 whitespace-nowrap rounded-[8px] border px-2.5 py-1.5 pointer-events-none"
                        style={{ background: t.cardBg, borderColor: t.cardBorder, boxShadow: '0 6px 20px rgba(0,0,0,0.35)' }}
                      >
                        <div className="text-[11px] font-semibold" style={{ color: t.textStrong }}>{fmtDay(d.business_date)}</div>
                        <div className="text-[12px] font-extrabold" style={{ color: t.rev }}>{usd(d.total_net_cents)}</div>
                        <div className="text-[11px]" style={{ color: t.muted }}>{Math.round(d.total_quantity)} items sold</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <p className="text-[11px] mt-3" style={{ color: t.faint }}>
        Every bar is one calendar day, thinnest-possible width so the whole history fits on one screen. Hover any bar for the exact total.
      </p>
    </Card>
  );
}

// -----------------------------------------------------------------------
// Top-level tab
// -----------------------------------------------------------------------
export default function ItemAnalytics({ t }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    adminFetch('/api/admin/analytics/item-sales')
      .then((json) => { if (!cancelled) setData(json); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="rounded-[14px] border p-5" style={{ background: t.warnCardBg, borderColor: t.warnCardBorder, color: t.warn }}>
        Could not load item analytics: {error}
      </div>
    );
  }
  if (!data) {
    return <p className="text-[13px]" style={{ color: t.muted }}>Loading item analytics…</p>;
  }

  return (
    <div data-testid="item-analytics-tab">
      <TopItemsCard t={t} topItemsByName={data.topItemsByName} topItemsByKey={data.topItemsByKey} fragmentedNames={data.fragmentedNames} />
      <PopularTimesCard t={t} salesByHour={data.salesByHour} topItemsByDaypart={data.topItemsByDaypart} />
      {data.itemCatalog.length > 0 && (
        <ItemTrendCard t={t} itemCatalog={data.itemCatalog} topItemsByName={data.topItemsByName} />
      )}
      <LeadTimeCard t={t} ticketTailorLeadTime={data.ticketTailorLeadTime} />
      <AllTimeDailySalesCard t={t} dailySales={data.dailySales} />
    </div>
  );
}
