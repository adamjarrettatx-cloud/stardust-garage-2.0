'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { centsToUsd } from '@/lib/event-analytics';
import { ENTRY_STATE, entriesInMonth, summarizeIncome } from '@/lib/financial-calendar';
import RefreshMetricsButton from '@/app/bananas/analytics/RefreshMetricsButton';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Category dot colors, matching the Event Analytics palette.
const CATEGORY_COLOR = {
  workshop: '#ffb84d', yoga: '#4ade80', party: '#f472b6', other: '#8a8a8a',
};

// Per-state presentation for non-revenue entries. `label` shows in the detail
// panel; `chip` is the short marker rendered on the calendar cell.
const STATE_META = {
  [ENTRY_STATE.PENDING]:        { chip: 'Not synced',     color: '#8a8a8a', note: 'Linked to TicketTailor but not refreshed yet.' },
  [ENTRY_STATE.UNLINKED]:       { chip: 'No TT link',     color: '#ffb84d', note: 'Not linked to a TicketTailor series — link it to track income.' },
  [ENTRY_STATE.NOT_CONFIGURED]: { chip: 'Not configured', color: '#ffb84d', note: 'TICKETTAILOR_API_KEY is not configured in this environment.' },
  [ENTRY_STATE.ERROR]:          { chip: 'Sync error',     color: '#f87171', note: 'The last TicketTailor refresh failed. Try refreshing again.' },
  [ENTRY_STATE.ZERO]:           { chip: '$0 so far',      color: '#8a8a8a', note: 'Refreshed — no sales recorded yet.' },
};

function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function fmtFetched(iso) {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// Headline value for a cell/detail: real income, an honest $0, or a state chip.
function cellIncomeLabel(entry) {
  if (entry.state === ENTRY_STATE.OK || entry.state === ENTRY_STATE.ZERO) {
    return centsToUsd(entry.grossCents);
  }
  return STATE_META[entry.state]?.chip || '—';
}

export default function FinancialCalendarClient({ entries, todayIso }) {
  const today = useMemo(() => new Date(todayIso), [todayIso]);

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(null);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  const monthEntries = useMemo(() => entriesInMonth(entries, year, month), [entries, year, month]);
  const monthSummary = useMemo(() => summarizeIncome(monthEntries), [monthEntries]);

  const entriesByDate = useMemo(() => {
    const map = {};
    for (const e of monthEntries) {
      if (!e.eventDate) continue;
      (map[e.eventDate] ||= []).push(e);
    }
    return map;
  }, [monthEntries]);

  const getEntriesForDate = (date) => {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return entriesByDate[key] || [];
  };

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
    setSelectedDay(null);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
    setSelectedDay(null);
  };
  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setSelectedDay(null);
  };

  const selectedEntries = selectedDay ? getEntriesForDate(selectedDay) : [];

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-12" data-testid="financial-calendar">
      {/* Header */}
      <Link
        href="/bananas"
        className="text-[12px] tracking-[0.14em] mb-4 inline-block hover:text-white transition-colors"
        style={{ color: '#8a8a8a' }}
      >
        ← BACK TO ADMIN
      </Link>

      <div className="flex flex-wrap items-baseline justify-between gap-4 mb-2">
        <h1
          className="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1]"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          Financial Calendar
        </h1>
        <div className="text-[11px] tracking-[0.18em]" style={{ color: '#8a8a8a' }}>
          OWNER ONLY
        </div>
      </div>
      <p className="mb-6 text-[14px]" style={{ color: '#8a8a8a' }}>
        TicketTailor income by event date, from the read-only metrics cache. Upcoming events show
        <strong className="mx-1" style={{ color: '#c8c8c8' }}>actual sales-to-date</strong>
        — not a forecast. Income only; expenses and other sources are not tracked yet.
      </p>

      {/* Controls: refresh + last updated */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <RefreshMetricsButton />
        <span className="text-[12px]" style={{ color: '#8a8a8a' }} data-testid="fc-last-updated">
          Metrics last synced: <span style={{ color: '#c8c8c8' }}>{fmtFetched(monthSummary.lastUpdated)}</span>
        </span>
      </div>

      {/* Monthly income summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8" data-testid="fc-month-summary">
        {[
          { label: 'Gross income', value: centsToUsd(monthSummary.grossCents), accent: true },
          { label: 'Revenue events', value: `${monthSummary.revenueEvents}/${monthSummary.eventCount}` },
          { label: 'Tickets sold', value: monthSummary.ticketsSold },
          { label: 'Orders', value: monthSummary.ordersCount },
        ].map((c) => (
          <div
            key={c.label}
            className="rounded-[14px] border p-5"
            style={c.accent
              ? { background: '#0f1a12', borderColor: 'rgba(74,222,128,0.22)' }
              : { background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}
          >
            <div className="text-[10px] font-semibold tracking-[0.14em] uppercase mb-1.5" style={{ color: c.accent ? '#4ade80' : '#8a8a8a' }}>{c.label}</div>
            <div className="text-[24px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Month nav */}
      <div className="flex items-center gap-4 mb-4">
        <button onClick={prevMonth} aria-label="Previous month" className="w-9 h-9 rounded-full border flex items-center justify-center transition-colors hover:bg-white/10 text-[16px]" style={{ borderColor: 'rgba(255,255,255,0.12)' }}>‹</button>
        <h2 data-testid="fc-month-label" className="text-[22px] font-extrabold -tracking-[0.01em] min-w-[220px] text-center" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          {MONTHS[month]} {year}
        </h2>
        <button onClick={nextMonth} aria-label="Next month" className="w-9 h-9 rounded-full border flex items-center justify-center transition-colors hover:bg-white/10 text-[16px]" style={{ borderColor: 'rgba(255,255,255,0.12)' }}>›</button>
        <button onClick={goToday} className="ml-2 px-4 py-1.5 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors hover:bg-white/10" style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#aaa' }}>TODAY</button>
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Calendar grid */}
        <div className="flex-1 min-w-0">
          <div className="grid grid-cols-7 mb-1">
            {DAYS.map((d) => (
              <div key={d} className="text-center text-[11px] font-semibold tracking-[0.12em] py-2" style={{ color: '#8a8a8a' }}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px" style={{ background: 'rgba(255,255,255,0.04)' }}>
            {Array.from({ length: totalCells }).map((_, i) => {
              const dayNum = i - firstDay + 1;
              const isCurrentMonth = dayNum >= 1 && dayNum <= daysInMonth;
              const cellDate = new Date(year, month, dayNum);
              const isToday = isCurrentMonth && isSameDay(cellDate, today);
              const isSelected = selectedDay && isCurrentMonth && isSameDay(cellDate, selectedDay);
              const dayEntries = isCurrentMonth ? getEntriesForDate(cellDate) : [];

              return (
                <div
                  key={i}
                  onClick={() => isCurrentMonth && dayEntries.length > 0 && setSelectedDay(cellDate)}
                  className="min-h-[100px] p-2 transition-colors"
                  style={{
                    background: isSelected ? 'rgba(255,255,255,0.08)' : isCurrentMonth ? '#141414' : '#0f0f0f',
                    outline: isSelected ? '1px solid rgba(255,255,255,0.2)' : 'none',
                    cursor: isCurrentMonth && dayEntries.length > 0 ? 'pointer' : 'default',
                  }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className="text-[13px] font-bold w-7 h-7 flex items-center justify-center rounded-full"
                      style={{
                        background: isToday ? '#ffffff' : 'transparent',
                        color: isToday ? '#0a0a0a' : isCurrentMonth ? '#f5f5f5' : '#333',
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                      }}
                    >
                      {isCurrentMonth ? dayNum : ''}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {dayEntries.slice(0, 3).map((entry) => {
                      const hasMoney = entry.state === ENTRY_STATE.OK;
                      return (
                        <div
                          key={entry.id}
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                          style={{
                            background: hasMoney ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.05)',
                            color: hasMoney ? '#4ade80' : '#c8c8c8',
                            border: `1px solid ${hasMoney ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.08)'}`,
                          }}
                          title={entry.title}
                        >
                          <div className="truncate flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: CATEGORY_COLOR[entry.category] || '#8a8a8a' }} />
                            {entry.title}
                          </div>
                          <div className="text-[9px] font-bold truncate">
                            {cellIncomeLabel(entry)}
                            {entry.isFuture && hasMoney && <span className="font-normal opacity-70"> · to date</span>}
                          </div>
                        </div>
                      );
                    })}
                    {dayEntries.length > 3 && (
                      <div className="text-[9px] font-semibold" style={{ color: '#8a8a8a' }}>+{dayEntries.length - 3} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Day detail panel */}
        {selectedDay && (
          <div className="w-full lg:w-[320px] flex-shrink-0 rounded-[14px] border p-5 self-start lg:sticky lg:top-6" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.08)' }} data-testid="fc-day-detail">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                {selectedDay.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </h3>
              <button onClick={() => setSelectedDay(null)} aria-label="Close detail" className="text-[18px] leading-none transition-opacity hover:opacity-50" style={{ color: '#8a8a8a' }}>×</button>
            </div>

            {selectedEntries.length === 0 && (
              <p className="text-[12px]" style={{ color: '#555' }}>No events this day.</p>
            )}

            <div className="space-y-3">
              {selectedEntries.map((entry) => {
                const hasMoney = entry.state === ENTRY_STATE.OK;
                const meta = STATE_META[entry.state];
                return (
                  <div key={entry.id} className="rounded-[10px] p-3" style={{ background: hasMoney ? '#0f1a12' : '#101010', border: `1px solid ${hasMoney ? 'rgba(74,222,128,0.22)' : 'rgba(255,255,255,0.08)'}` }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: CATEGORY_COLOR[entry.category] || '#8a8a8a' }} />
                      {entry.hasLocalEvent === false ? (
                        // TicketTailor-only event: no local page to link to.
                        <span className="text-[14px] font-bold truncate" title="TicketTailor-only event (no website record)">{entry.title}</span>
                      ) : (
                        <Link href={`/bananas/events/${entry.id}`} className="text-[14px] font-bold hover:underline truncate">{entry.title}</Link>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mb-2 text-[10px] tracking-[0.08em] uppercase" style={{ color: '#8a8a8a' }}>
                      {entry.eventStatus && <span>{entry.eventStatus}</span>}
                      {entry.isFuture && (
                        <span className="px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(255,184,77,0.14)', color: '#ffb84d' }}>Upcoming</span>
                      )}
                    </div>

                    {hasMoney || entry.state === ENTRY_STATE.ZERO ? (
                      <>
                        <div className="text-[22px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: hasMoney ? '#4ade80' : '#c8c8c8' }}>
                          {centsToUsd(entry.grossCents)}
                        </div>
                        <div className="text-[10px] mb-2" style={{ color: '#8a8a8a' }}>
                          {entry.isFuture ? 'Gross TicketTailor sales-to-date (not a forecast)' : 'Gross TicketTailor income'}
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-[11px]">
                          <div>
                            <div className="uppercase tracking-[0.08em] mb-0.5" style={{ color: '#6a6a6a' }}>Net</div>
                            <div style={{ color: '#c8c8c8' }}>{centsToUsd(entry.netCents)}</div>
                          </div>
                          <div>
                            <div className="uppercase tracking-[0.08em] mb-0.5" style={{ color: '#6a6a6a' }}>Tickets</div>
                            <div style={{ color: '#c8c8c8' }}>{entry.ticketsSold}</div>
                          </div>
                          <div>
                            <div className="uppercase tracking-[0.08em] mb-0.5" style={{ color: '#6a6a6a' }}>Orders</div>
                            <div style={{ color: '#c8c8c8' }}>{entry.ordersCount}</div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-[12px]" style={{ color: meta?.color || '#8a8a8a' }}>
                        {meta?.chip}
                        <div className="text-[11px] mt-1" style={{ color: '#8a8a8a' }}>{meta?.note}</div>
                      </div>
                    )}

                    <div className="text-[10px] mt-2 pt-2" style={{ color: '#6a6a6a', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      Last synced: {fmtFetched(entry.fetchedAt)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <p className="mt-6 text-[12px]" style={{ color: '#6a6a6a' }}>
        Income figures come from the read-only TicketTailor metrics cache, refreshed on a daily cron or on
        demand above. Historical months reflect stored metrics; upcoming events show real sales collected so
        far and are labeled accordingly. SpotOn point-of-sale income is not included yet.
      </p>
    </main>
  );
}
