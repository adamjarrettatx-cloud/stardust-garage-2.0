'use client';

// Merged Financials page — the single home for what used to be Event
// Analytics (member-code engagement + per-event performance table) and the
// Financial Calendar (day-by-day income view + manual income CRUD). See
// lib/financial-overview.js for the unified accounting this page renders:
// every dollar (TT-linked events, TT-only discovered events, manual income)
// is counted exactly once in `totals`, fixing the old Analytics undercount.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { centsToUsd } from '@/lib/event-analytics';
import { ENTRY_STATE, entriesInMonth, summarizeIncome } from '@/lib/financial-calendar';
import { entryNetCents, buildDailyRevenue, rollupDailyRevenue } from '@/lib/financial-overview';
import { MANUAL_CATEGORIES } from '@/lib/manual-income';
import { adminFetch } from '@/lib/admin-fetch';
import { useAuthenticatedTheme } from '@/app/components/AuthenticatedThemeProvider';
import { ANALYTICS_THEMES, FINANCIAL_THEMES } from '@/lib/admin-theme';
import RefreshMetricsButton from '@/app/bananas/analytics/RefreshMetricsButton';
import RowRefreshButton from '@/app/bananas/analytics/RowRefreshButton';
import TotalSalesChart from '@/app/bananas/financials/TotalSalesChart';
import ManualIncomeDialog from '@/app/bananas/financial-calendar/ManualIncomeDialog';
import RevenueTrendChart from '@/app/bananas/financials/RevenueTrendChart';
import ItemAnalytics from '@/app/bananas/financials/ItemAnalytics';

// Merged palette: FINANCIAL_THEMES' richer calendar/detail tokens (cellBg,
// gridLine, revChipBg, etc.) plus the table-only tokens ANALYTICS_THEMES adds
// (tableBorder, rowBorder, warnCardBg, warnCardBorder, grossText, codeText).
// Every key the two palettes share carries byte-identical values in both
// source objects (lib/admin-theme.js), so this union changes nothing visually
// for either the old calendar look or the old table look — it just gives this
// page access to both vocabularies at once.
const THEMES = {
  dark: { ...ANALYTICS_THEMES.dark, ...FINANCIAL_THEMES.dark },
  light: { ...ANALYTICS_THEMES.light, ...FINANCIAL_THEMES.light },
};

// Category dot colors, matching both original pages.
const CATEGORY_COLOR = {
  workshop: '#ffb84d', yoga: '#4ade80', party: '#f472b6', other: '#8a8a8a',
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MANUAL_CATEGORY_LABEL = Object.fromEntries(MANUAL_CATEGORIES.map((c) => [c.value, c.label]));

// Per-state presentation for non-revenue entries. `label` shows in the detail
// panel; `chip` is the short marker rendered on the calendar cell.
const STATE_META = {
  [ENTRY_STATE.PENDING]:        { chip: 'Not synced',     note: 'Linked to TicketTailor but not refreshed yet.' },
  [ENTRY_STATE.UNLINKED]:       { chip: 'No TT link',     note: 'Not linked to a TicketTailor series — link it to track income.' },
  [ENTRY_STATE.NOT_CONFIGURED]: { chip: 'Not configured', note: 'TICKETTAILOR_API_KEY is not configured in this environment.' },
  [ENTRY_STATE.ERROR]:          { chip: 'Sync error',     note: 'The last TicketTailor refresh failed. Try refreshing again.' },
  [ENTRY_STATE.ZERO]:           { chip: '$0 so far',      note: 'Refreshed — no sales recorded yet.' },
};

function fmtDate(s) {
  if (!s) return '—';
  return new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtFetched(iso) {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function toDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

// Headline value for a calendar cell: real income, an honest $0, or a state chip.
function cellIncomeLabel(entry) {
  if (entry.state === ENTRY_STATE.OK || entry.state === ENTRY_STATE.ZERO) {
    return centsToUsd(entry.grossCents);
  }
  return STATE_META[entry.state]?.chip || '—';
}

const TABS = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'performance', label: 'Performance' },
  { id: 'trends', label: 'Trends' },
  { id: 'items', label: 'Item Sales' },
];

const GRANULARITIES = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

export default function FinancialsClient({ entries, performanceRows, totals, todayIso, posTransactions = [] }) {
  const router = useRouter();
  const today = useMemo(() => new Date(todayIso), [todayIso]);
  // Only `theme` is read here: the toggle control lives in the admin shell
  // header, so this page selects its palette but never offers the switch.
  const { theme } = useAuthenticatedTheme();
  const t = THEMES[theme];

  const [tab, setTab] = useState('calendar');

  // Every dollar, per calendar day, regardless of whether a named event
  // landed that day — this is what lets a Tuesday-afternoon walk-in sale
  // show up next to a Saturday event in the same rollups. See
  // lib/financial-overview.buildDailyRevenue for the merge logic.
  const dailyRevenue = useMemo(() => buildDailyRevenue({ entries, posTransactions }), [entries, posTransactions]);
  const dailyByDate = useMemo(() => new Map(dailyRevenue.map((d) => [d.date, d])), [dailyRevenue]);

  // ---- Trends tab state ----
  const [trendGranularity, setTrendGranularity] = useState('week');
  const trendBuckets = useMemo(
    () => rollupDailyRevenue(dailyRevenue, trendGranularity),
    [dailyRevenue, trendGranularity],
  );

  // ---- Calendar tab state (adapted from the old Financial Calendar) ----
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(null);

  // Manual-income add/edit dialog + delete state (shared across both tabs).
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [dialogDate, setDialogDate] = useState(null);
  const [linkForEvent, setLinkForEvent] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);

  const openAdd = () => {
    setEditingEntry(null);
    setLinkForEvent(null);
    setDialogDate(selectedDay ? toDateInput(selectedDay) : toDateInput(today));
    setDialogOpen(true);
  };
  const openAddToEvent = (entry) => {
    setEditingEntry(null);
    setDialogDate(entry.eventDate || null);
    setLinkForEvent({ id: entry.id, title: entry.title, date: entry.eventDate });
    setDialogOpen(true);
  };
  const openEdit = (entry) => {
    setEditingEntry(entry);
    setLinkForEvent(null);
    setDialogDate(null);
    setDialogOpen(true);
  };
  const closeDialog = () => { setDialogOpen(false); setEditingEntry(null); setLinkForEvent(null); };

  const deleteEntry = async (entry) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete "${entry.title}"? This cannot be undone.`)) return;
    setDeletingId(entry.manualId);
    setDeleteError(null);
    try {
      await adminFetch('/api/admin/manual-income', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.manualId }),
      });
      router.refresh();
    } catch (err) {
      setDeleteError(err?.message || 'Could not delete the entry.');
    } finally {
      setDeletingId(null);
    }
  };

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  const monthEntries = useMemo(() => entriesInMonth(entries, year, month), [entries, year, month]);
  const monthSummary = useMemo(() => summarizeIncome(monthEntries), [monthEntries]);

  // All-source figures for the visible month, independent of whether a day
  // has a named event — pulled from the unified daily rollup rather than
  // monthEntries so a POS-only weekday still counts.
  const monthDailyRevenue = useMemo(() => dailyRevenue.filter((d) => {
    const dt = new Date(`${d.date}T00:00:00`);
    return dt.getFullYear() === year && dt.getMonth() === month;
  }), [dailyRevenue, year, month]);
  const monthPosRevenueCents = useMemo(() => monthDailyRevenue.reduce((sum, d) => sum + d.posRevenueCents, 0), [monthDailyRevenue]);
  const monthAllSourceNetCents = useMemo(() => monthDailyRevenue.reduce((sum, d) => sum + d.totalNetCents, 0), [monthDailyRevenue]);

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
  const selectedDayIso = selectedDay ? toDateInput(selectedDay) : null;
  const selectedDayRow = selectedDayIso ? dailyByDate.get(selectedDayIso) : null;
  const selectedPosRevenueCents = selectedDayRow?.posRevenueCents || 0;
  const selectedPosRefundCents = selectedDayRow?.posRefundCents || 0;
  const selectedPosNetCents = selectedDayRow?.posNetCents || 0;
  const hasSelectedPos = selectedPosRevenueCents !== 0 || selectedPosRefundCents !== 0;
  const selectedTotalAllSourcesCents = selectedDayRow?.totalNetCents
    ?? selectedEntries.reduce((sum, e) => sum + entryNetCents(e), 0);

  const gridCols = 'grid-cols-[1fr_100px_90px_90px_70px_70px_80px]';
  const trendGridCols = 'grid-cols-[1fr_110px_110px_100px_110px_110px_60px]';

  return (
    <div style={{ color: t.text }}
      data-testid="financials">

      <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
        <h1
          className="text-[32px] font-extrabold -tracking-[0.02em] leading-[1.1]"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}
        >
          Financials
        </h1>
        <div className="flex items-center gap-3">
          <div className="text-[11px] tracking-[0.18em]" style={{ color: t.muted }}>
            OWNER ONLY
          </div>
        </div>
      </div>
      <p className="mb-6 text-[14px]" style={{ color: t.muted }}>
        Every income source in one place, mapped to the calendar day it landed on — TicketTailor sales (linked
        events and TT-only events), SpotOn point-of-sale revenue (including days with no event on the books),
        member-code engagement, and owner-entered manual income (e.g. venue rentals). Revenue figures come from the
        read-only metrics cache, refreshed on a daily cron or on demand below. Income only; expenses aren&apos;t
        tracked yet.
      </p>

      <TotalSalesChart dailyRevenue={dailyRevenue} todayIso={todayIso} t={t} />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <RefreshMetricsButton />
          <button
            type="button"
            onClick={openAdd}
            data-testid="fin-add-income"
            className="text-[12px] font-semibold tracking-[0.10em] uppercase rounded-[10px] px-4 py-2 transition-colors"
            style={{ background: t.addBtnBg, color: t.addBtnText }}
          >
            + Add income
          </button>
        </div>
        <span className="text-[12px]" style={{ color: t.muted }} data-testid="fin-last-updated">
          Metrics last synced: <span style={{ color: t.mutedStrong }}>{fmtFetched(totals.lastUpdated)}</span>
        </span>
      </div>

      {deleteError && (
        <p className="text-[12px] mb-4 rounded-[8px] px-3 py-2" style={{ background: t.errBg, color: t.err }} role="alert" data-testid="fin-delete-error">
          {deleteError}
        </p>
      )}

      <div className="mb-10" />

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-6 border-b" style={{ borderColor: t.tableBorder }}>
        {TABS.map((tb) => (
          <button
            key={tb.id}
            type="button"
            onClick={() => setTab(tb.id)}
            data-testid={`fin-tab-${tb.id}`}
            className="px-4 py-2.5 text-[13px] font-semibold tracking-[0.06em] uppercase transition-colors border-b-2 -mb-px"
            style={{
              color: tab === tb.id ? t.textStrong : t.muted,
              borderColor: tab === tb.id ? t.rev : 'transparent',
            }}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'calendar' && (
        <>
          {/* Monthly income summary — named-event figures (TicketTailor + manual)
              plus the all-source rollup that folds in POS-only days. */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8" data-testid="fin-month-summary">
            {[
              { label: 'Event gross income', value: centsToUsd(monthSummary.grossCents), accent: true },
              { label: 'POS revenue (SpotOn)', value: centsToUsd(monthPosRevenueCents), pos: true },
              { label: 'All-source net', value: centsToUsd(monthAllSourceNetCents), accent: true },
            ].map((c) => (
              <div
                key={c.label}
                className="rounded-[14px] border p-5"
                style={c.accent
                  ? { background: t.revCardBg, borderColor: t.revCardBorder }
                  : c.pos
                    ? { background: t.posCardBg, borderColor: t.posCardBorder }
                    : { background: t.cardBg, borderColor: t.cardBorder }}
              >
                <div className="text-[10px] font-semibold tracking-[0.14em] uppercase mb-1.5" style={{ color: c.accent ? t.rev : c.pos ? t.pos : t.muted }}>{c.label}</div>
                <div className="text-[24px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}>{c.value}</div>
              </div>
            ))}
          </div>

          {/* Month nav */}
          <div className="flex items-center gap-4 mb-4">
            <button onClick={prevMonth} aria-label="Previous month" className="w-9 h-9 rounded-full border flex items-center justify-center transition-colors text-[16px]" style={{ borderColor: t.border, color: t.text, background: 'transparent' }} onMouseEnter={(e) => { e.currentTarget.style.background = t.hoverBg; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>‹</button>
            <h2 data-testid="fin-month-label" className="text-[22px] font-extrabold -tracking-[0.01em] min-w-[220px] text-center" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}>
              {MONTHS[month]} {year}
            </h2>
            <button onClick={nextMonth} aria-label="Next month" className="w-9 h-9 rounded-full border flex items-center justify-center transition-colors text-[16px]" style={{ borderColor: t.border, color: t.text, background: 'transparent' }} onMouseEnter={(e) => { e.currentTarget.style.background = t.hoverBg; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>›</button>
            <button onClick={goToday} className="ml-2 px-4 py-1.5 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors" style={{ borderColor: t.border, color: t.mutedStrong, background: 'transparent' }} onMouseEnter={(e) => { e.currentTarget.style.background = t.hoverBg; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>TODAY</button>
          </div>

          <div className="flex flex-col lg:flex-row gap-5">
            {/* Calendar grid */}
            <div className="flex-1 min-w-0">
              <div className="grid grid-cols-7 mb-1">
                {DAYS.map((d) => (
                  <div key={d} className="text-center text-[11px] font-semibold tracking-[0.12em] py-2" style={{ color: t.muted }}>{d}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-px" style={{ background: t.gridLine }}>
                {Array.from({ length: totalCells }).map((_, i) => {
                  const dayNum = i - firstDay + 1;
                  const isCurrentMonth = dayNum >= 1 && dayNum <= daysInMonth;
                  const cellDate = new Date(year, month, dayNum);
                  const isToday = isCurrentMonth && isSameDay(cellDate, today);
                  const isSelected = selectedDay && isCurrentMonth && isSameDay(cellDate, selectedDay);
                  const dayEntries = isCurrentMonth ? getEntriesForDate(cellDate) : [];
                  const dayPos = isCurrentMonth ? dailyByDate.get(toDateInput(cellDate)) : null;
                  const hasDayPos = !!dayPos && (dayPos.posRevenueCents !== 0 || dayPos.posRefundCents !== 0);
                  const dayIsClickable = isCurrentMonth && (dayEntries.length > 0 || hasDayPos);

                  return (
                    <div
                      key={i}
                      onClick={() => dayIsClickable && setSelectedDay(cellDate)}
                      className="min-h-[100px] p-2 transition-colors"
                      style={{
                        background: isSelected ? t.selectedBg : isCurrentMonth ? t.cellBg : t.cellBgOutside,
                        outline: isSelected ? t.selectedOutline : 'none',
                        cursor: dayIsClickable ? 'pointer' : 'default',
                      }}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span
                          className="text-[13px] font-bold w-7 h-7 flex items-center justify-center rounded-full"
                          style={{
                            background: isToday ? t.todayBg : 'transparent',
                            color: isToday ? t.todayText : isCurrentMonth ? t.text : t.dayNumOutside,
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
                                background: hasMoney ? t.revChipBg : t.neutralChipBg,
                                color: hasMoney ? t.rev : t.mutedStrong,
                                border: `1px solid ${hasMoney ? t.revChipBorder : t.neutralChipBorder}`,
                              }}
                              title={entry.title}
                            >
                              <div className="flex items-center gap-1 min-w-0">
                                <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: CATEGORY_COLOR[entry.category] || t.muted }} />
                                <span className="truncate min-w-0">{entry.title}</span>
                              </div>
                              <div className="text-[9px] font-bold truncate">
                                {cellIncomeLabel(entry)}
                                {entry.isFuture && hasMoney && !entry.isManual && <span className="font-normal opacity-70"> · to date</span>}
                              </div>
                            </div>
                          );
                        })}
                        {dayEntries.length > 3 && (
                          <div className="text-[9px] font-semibold" style={{ color: t.muted }}>+{dayEntries.length - 3} more</div>
                        )}
                        {hasDayPos && (
                          <div
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1 min-w-0"
                            style={{ background: t.posChipBg, color: t.pos, border: `1px solid ${t.posChipBorder}` }}
                            title="SpotOn point-of-sale income on this day"
                            data-testid="fin-cell-pos-chip"
                          >
                            <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: t.pos }} />
                            <span className="truncate min-w-0">POS {centsToUsd(dayPos.posNetCents)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Day detail panel */}
            {selectedDay && (
              <div className="w-full lg:w-[320px] flex-shrink-0 rounded-[14px] border p-5 self-start lg:sticky lg:top-6" style={{ background: t.cardBg, borderColor: t.borderSoft }} data-testid="fin-day-detail">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[16px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}>
                    {selectedDay.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                  </h3>
                  <button onClick={() => setSelectedDay(null)} aria-label="Close detail" className="text-[18px] leading-none transition-opacity hover:opacity-50" style={{ color: t.muted }}>×</button>
                </div>

                {selectedEntries.length === 0 && !hasSelectedPos && (
                  <p className="text-[12px]" style={{ color: t.faint }}>No income recorded this day.</p>
                )}

                {(selectedEntries.length > 0 || hasSelectedPos) && (selectedEntries.length > 1 || hasSelectedPos) && (
                  <div
                    className="rounded-[10px] p-3 mb-3 flex items-center justify-between"
                    style={{ background: t.revSubBg, border: `1px solid ${t.revSubBorder}` }}
                    data-testid="fin-day-total-all-sources"
                  >
                    <span className="text-[11px] font-semibold tracking-[0.06em] uppercase" style={{ color: t.muted }}>
                      Total this day (all sources)
                    </span>
                    <span className="text-[15px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.rev }}>
                      {centsToUsd(selectedTotalAllSourcesCents)}
                    </span>
                  </div>
                )}

                <div className="space-y-3">
                  {selectedEntries.map((entry) => {
                    const hasMoney = entry.state === ENTRY_STATE.OK;
                    const meta = STATE_META[entry.state];
                    const detailHasMoney = hasMoney || entry.hasManualIncome;
                    return (
                      <div key={entry.id} className="rounded-[10px] p-3" style={{ background: detailHasMoney ? t.revDetailBg : t.neutralDetailBg, border: `1px solid ${detailHasMoney ? t.revDetailBorder : t.borderSoft}` }} data-testid={entry.isManual ? 'fin-manual-detail' : undefined}>
                        <div className="flex items-center gap-2 mb-1 min-w-0">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: CATEGORY_COLOR[entry.category] || t.muted }} />
                          {entry.isManual || entry.hasLocalEvent === false ? (
                            <span className="text-[14px] font-bold truncate min-w-0" style={{ color: t.textStrong }} title={entry.isManual ? 'Manual income entry' : 'TicketTailor-only event (no website record)'}>{entry.title}</span>
                          ) : (
                            <Link href={`/bananas/events/${entry.id}`} className="text-[14px] font-bold hover:underline truncate min-w-0" style={{ color: t.textStrong }}>{entry.title}</Link>
                          )}
                        </div>

                        <div className="flex items-center gap-2 mb-2 text-[10px] tracking-[0.08em] uppercase" style={{ color: t.muted }}>
                          {entry.isManual && (
                            <span className="px-1.5 py-0.5 rounded-full" style={{ background: t.revChipBg, color: t.rev }}>Manual</span>
                          )}
                          {entry.eventStatus && <span>{entry.eventStatus}</span>}
                          {entry.isFuture && (
                            <span className="px-1.5 py-0.5 rounded-full" style={{ background: t.warnBadgeBg, color: t.warn }}>Upcoming</span>
                          )}
                        </div>

                        {entry.isManual ? (
                          <>
                            <div className="text-[22px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.rev }}>
                              {centsToUsd(entry.grossCents)}
                            </div>
                            <div className="text-[10px] mb-2" style={{ color: t.muted }}>
                              Manual income · {MANUAL_CATEGORY_LABEL[entry.category] || entry.category}
                            </div>
                            {(entry.customerName || entry.eventName) && (
                              <div className="text-[11px] mb-1" style={{ color: t.mutedStrong }}>
                                {[entry.customerName, entry.eventName].filter(Boolean).join(' · ')}
                              </div>
                            )}
                            {entry.notes && (
                              <p className="text-[11px] mb-1 whitespace-pre-wrap" style={{ color: t.muted }}>{entry.notes}</p>
                            )}
                            <div className="flex items-center gap-3 mt-2 pt-2" style={{ borderTop: `1px solid ${t.divider}` }}>
                              <button type="button" onClick={() => openEdit(entry)} data-testid="fin-manual-edit" className="text-[11px] font-semibold tracking-[0.08em] uppercase transition-opacity hover:opacity-70" style={{ color: t.mutedStrong }}>Edit</button>
                              <button type="button" onClick={() => deleteEntry(entry)} disabled={deletingId === entry.manualId} data-testid="fin-manual-delete" className="text-[11px] font-semibold tracking-[0.08em] uppercase transition-colors disabled:opacity-50" style={{ color: t.err }}>
                                {deletingId === entry.manualId ? 'Deleting…' : 'Delete'}
                              </button>
                            </div>
                          </>
                        ) : entry.hasManualIncome ? (
                          <div data-testid="fin-event-combined">
                            <div className="text-[22px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.rev }}>
                              {centsToUsd(entry.grossCents)}
                            </div>
                            <div className="text-[10px] mb-2" style={{ color: t.muted }}>Combined income</div>
                            <div className="space-y-1 text-[11px]" data-testid="fin-event-breakdown">
                              {entry.ttLinked && (
                                <div className="flex items-center justify-between">
                                  <span style={{ color: t.muted }}>TicketTailor{entry.isFuture ? ' (to date)' : ''}</span>
                                  <span style={{ color: t.mutedStrong }}>
                                    {hasMoney || entry.state === ENTRY_STATE.ZERO
                                      ? centsToUsd(entry.ttGrossCents)
                                      : (STATE_META[entry.state]?.chip || '—')}
                                  </span>
                                </div>
                              )}
                              <div className="flex items-center justify-between">
                                <span style={{ color: t.muted }}>Manual</span>
                                <span style={{ color: t.mutedStrong }}>{centsToUsd(entry.manualGrossCents)}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span style={{ color: t.muted }}>Net (combined)</span>
                                <span style={{ color: t.mutedStrong }}>{centsToUsd(entryNetCents(entry))}</span>
                              </div>
                            </div>
                          </div>
                        ) : hasMoney || entry.state === ENTRY_STATE.ZERO ? (
                          <>
                            <div className="text-[22px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: hasMoney ? t.rev : t.mutedStrong }}>
                              {centsToUsd(entry.grossCents)}
                            </div>
                            <div className="text-[10px] mb-2" style={{ color: t.muted }}>
                              {entry.isFuture ? 'Gross TicketTailor sales-to-date (not a forecast)' : 'Gross TicketTailor income'}
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-[11px]">
                              <div>
                                <div className="uppercase tracking-[0.08em] mb-0.5" style={{ color: t.faint }}>Net</div>
                                <div style={{ color: t.mutedStrong }}>{centsToUsd(entry.netCents)}</div>
                              </div>
                              <div>
                                <div className="uppercase tracking-[0.08em] mb-0.5" style={{ color: t.faint }}>Tickets</div>
                                <div style={{ color: t.mutedStrong }}>{entry.ticketsSold}</div>
                              </div>
                              <div>
                                <div className="uppercase tracking-[0.08em] mb-0.5" style={{ color: t.faint }}>Orders</div>
                                <div style={{ color: t.mutedStrong }}>{entry.ordersCount}</div>
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="text-[12px]" style={{ color: meta?.tone === 'warn' ? t.warn : meta?.tone === 'err' ? t.err : t.muted }}>
                            {meta?.chip}
                            <div className="text-[11px] mt-1" style={{ color: t.muted }}>{meta?.note}</div>
                          </div>
                        )}

                        {/* Manual income linked to this event (owner-entered). */}
                        {!entry.isManual && entry.manualEntries?.length > 0 && (
                          <div className="mt-3 pt-2 space-y-2" style={{ borderTop: `1px solid ${t.divider}` }} data-testid="fin-event-manual-list">
                            {entry.manualEntries.map((m) => (
                              <div key={m.id} className="rounded-[8px] p-2" style={{ background: t.revSubBg, border: `1px solid ${t.revSubBorder}` }} data-testid="fin-event-manual-item">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[11px] font-semibold truncate min-w-0" style={{ color: t.mutedStrong }}>{m.title}</span>
                                  <span className="text-[12px] font-bold flex-shrink-0" style={{ color: t.rev }}>{centsToUsd(m.grossCents)}</span>
                                </div>
                                <div className="text-[10px] mt-0.5" style={{ color: t.muted }}>
                                  Manual · {MANUAL_CATEGORY_LABEL[m.category] || m.category}
                                  {m.customerName ? ` · ${m.customerName}` : ''}
                                </div>
                                {m.notes && (
                                  <p className="text-[10px] mt-1 whitespace-pre-wrap" style={{ color: t.muted }}>{m.notes}</p>
                                )}
                                <div className="flex items-center gap-3 mt-1">
                                  <button type="button" onClick={() => openEdit({ ...m, parentTitle: entry.title })} data-testid="fin-manual-edit" className="text-[10px] font-semibold tracking-[0.08em] uppercase transition-opacity hover:opacity-70" style={{ color: t.mutedStrong }}>Edit</button>
                                  <button type="button" onClick={() => deleteEntry(m)} disabled={deletingId === m.manualId} data-testid="fin-manual-delete" className="text-[10px] font-semibold tracking-[0.08em] uppercase transition-colors disabled:opacity-50" style={{ color: t.err }}>
                                    {deletingId === m.manualId ? 'Deleting…' : 'Delete'}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {!entry.isManual && entry.hasLocalEvent && (
                          <button
                            type="button"
                            onClick={() => openAddToEvent(entry)}
                            data-testid="fin-add-income-to-event"
                            className="mt-3 w-full text-[11px] font-semibold tracking-[0.08em] uppercase rounded-[8px] px-3 py-2 border transition-colors"
                            style={{ borderColor: t.revChipBorder, color: t.rev, background: 'transparent' }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = t.revChipBg; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            + Add income to event
                          </button>
                        )}

                        {!entry.isManual && (
                          <div className="text-[10px] mt-2 pt-2" style={{ color: t.faint, borderTop: `1px solid ${t.divider}` }}>
                            Last synced: {fmtFetched(entry.fetchedAt)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {hasSelectedPos && (
                  <div
                    className="rounded-[10px] p-3 mt-3"
                    style={{ background: t.posDetailBg, border: `1px solid ${t.posDetailBorder}` }}
                    data-testid="fin-day-pos-detail"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.pos }} />
                      <span className="text-[13px] font-bold" style={{ color: t.textStrong }}>Point of sale (SpotOn)</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        <div className="uppercase tracking-[0.08em] mb-0.5" style={{ color: t.faint }}>Revenue</div>
                        <div className="text-[14px] font-extrabold" style={{ color: t.pos }}>{centsToUsd(selectedPosRevenueCents)}</div>
                      </div>
                      <div>
                        <div className="uppercase tracking-[0.08em] mb-0.5" style={{ color: t.faint }}>Refunds</div>
                        <div style={{ color: t.mutedStrong }}>{selectedPosRefundCents !== 0 ? centsToUsd(selectedPosRefundCents) : '$0.00'}</div>
                      </div>
                      <div>
                        <div className="uppercase tracking-[0.08em] mb-0.5" style={{ color: t.faint }}>Net</div>
                        <div style={{ color: t.mutedStrong }}>{centsToUsd(selectedPosNetCents)}</div>
                      </div>
                    </div>
                    <div className="text-[10px] mt-2 pt-2" style={{ color: t.faint, borderTop: `1px solid ${t.divider}` }}>
                      From imported SpotOn CSV totals for this calendar day — not tied to a named event.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <p className="mt-6 text-[12px]" style={{ color: t.faint }}>
            TicketTailor figures come from the read-only metrics cache, refreshed on a daily cron or on demand
            above (upcoming events show real sales-to-date, not a forecast). Entries tagged <span style={{ color: t.rev }}>Manual</span> are
            owner-entered income (e.g. venue rentals) with no ticketing record. Days marked <span style={{ color: t.pos }}>POS</span> include
            SpotOn point-of-sale income imported from CSV, even on days with no event on the books — see the Trends tab for
            day/week/month rollups across every revenue source.
          </p>
        </>
      )}

      {tab === 'performance' && (
        <>
          <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase mb-3" style={{ color: t.muted }}>
            Performance by event
          </h2>
          {performanceRows.length === 0 ? (
            <p className="text-[13px]" style={{ color: t.muted }}>No events yet.</p>
          ) : (
            <div className="rounded-[12px] border overflow-hidden" style={{ background: t.cardBg, borderColor: t.cardBorder }}>
              {/* Fixed-width columns (Date/Gross/Net/Sold/Codes/TT) don't fit narrow
                  screens, so this scrolls horizontally on mobile instead of clipping
                  or overlapping columns. The inner min-w keeps every column at its
                  intended width regardless of viewport. */}
              <div className="overflow-x-auto">
              <div className="min-w-[720px]">
              <div className={`grid ${gridCols} gap-2 px-4 py-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase`} style={{ color: t.muted, borderBottom: `1px solid ${t.tableBorder}` }}>
                <span>Event</span><span>Date</span><span>Gross</span><span>Net</span><span>Sold</span><span>Codes</span><span>TT</span>
              </div>
              {performanceRows.map((r) => {
                // A row shows real figures once TicketTailor has been refreshed
                // (even a genuine $0) or manual income has been folded in; an
                // unlinked/un-refreshed row shows "—" rather than a guess.
                const hasRealMoney = r.state === ENTRY_STATE.OK || r.state === ENTRY_STATE.ZERO || r.hasManualIncome;
                return (
                  <div key={r.id} className={`grid ${gridCols} gap-2 px-4 py-3 text-[13px] items-center`} style={{ borderTop: `1px solid ${t.rowBorder}` }}>
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: CATEGORY_COLOR[r.category] || t.muted }} />
                      <Link href={`/bananas/events/${r.id}`} className="truncate min-w-0 hover:underline" style={{ color: t.text }}>{r.title}</Link>
                      {r.hasManualIncome && (
                        <span
                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                          style={{ background: t.revChipBg, color: t.rev }}
                          title={`Includes ${centsToUsd(r.manualGrossCents)} manual income`}
                        >
                          +manual
                        </span>
                      )}
                    </span>
                    <span style={{ color: t.mutedStrong }}>{fmtDate(r.eventDate)}</span>
                    <span style={{ color: hasRealMoney ? t.grossText : t.faint }}>{hasRealMoney ? centsToUsd(r.grossCents) : '—'}</span>
                    <span style={{ color: hasRealMoney ? t.rev : t.faint }}>{hasRealMoney ? centsToUsd(entryNetCents(r)) : '—'}</span>
                    <span style={{ color: hasRealMoney ? t.grossText : t.faint }}>{hasRealMoney ? r.ticketsSold : '—'}</span>
                    <span style={{ color: t.text }} title={`${r.memberCodes.sent} sent / ${r.memberCodes.total} total`}>
                      {r.memberCodes.sent}/{r.memberCodes.total}
                    </span>
                    {r.ttLinked ? (
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
              </div>
            </div>
          )}

          <p className="mt-6 text-[12px]" style={{ color: t.faint }}>
            Codes column shows member discount codes sent / generated for the event. Gross and Net include manual
            income folded into an event (marked <span style={{ color: t.rev }}>+manual</span>). Other revenue
            columns stay blank until the event is TT-linked and refreshed, or manual income is added.
          </p>
        </>
      )}

      {tab === 'trends' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase" style={{ color: t.muted }}>
              Revenue over time — every source, every day
            </h2>
            <div className="flex items-center gap-1 rounded-full border p-1" style={{ borderColor: t.border }} data-testid="fin-trend-granularity">
              {GRANULARITIES.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setTrendGranularity(g.id)}
                  data-testid={`fin-trend-granularity-${g.id}`}
                  className="px-3.5 py-1.5 rounded-full text-[11px] font-semibold tracking-[0.08em] uppercase transition-colors"
                  style={{
                    background: trendGranularity === g.id ? t.rev : 'transparent',
                    color: trendGranularity === g.id ? t.addBtnText : t.mutedStrong,
                  }}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {(() => {
            const rangeEventGross = trendBuckets.reduce((sum, b) => sum + b.eventGrossCents, 0);
            const rangePosRevenue = trendBuckets.reduce((sum, b) => sum + b.posRevenueCents, 0);
            const rangePosRefund = trendBuckets.reduce((sum, b) => sum + b.posRefundCents, 0);
            const rangeTotalGross = trendBuckets.reduce((sum, b) => sum + b.totalGrossCents, 0);
            const rangeTotalNet = trendBuckets.reduce((sum, b) => sum + b.totalNetCents, 0);
            return (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6" data-testid="fin-trend-summary">
                {[
                  { label: 'Event revenue', value: centsToUsd(rangeEventGross), accent: true },
                  { label: 'POS revenue (SpotOn)', value: centsToUsd(rangePosRevenue), pos: true },
                  { label: 'POS refunds', value: centsToUsd(rangePosRefund) },
                  { label: 'Total gross (all sources)', value: centsToUsd(rangeTotalGross), accent: true },
                  { label: 'Total net (all sources)', value: centsToUsd(rangeTotalNet), accent: true },
                ].map((c) => (
                  <div
                    key={c.label}
                    className="rounded-[14px] border p-5"
                    style={c.accent
                      ? { background: t.revCardBg, borderColor: t.revCardBorder }
                      : c.pos
                        ? { background: t.posCardBg, borderColor: t.posCardBorder }
                        : { background: t.cardBg, borderColor: t.cardBorder }}
                  >
                    <div className="text-[10px] font-semibold tracking-[0.14em] uppercase mb-1.5" style={{ color: c.accent ? t.rev : c.pos ? t.pos : t.muted }}>{c.label}</div>
                    <div className="text-[22px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}>{c.value}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          <RevenueTrendChart buckets={trendBuckets} t={t} granularity={trendGranularity} />

          {trendBuckets.length === 0 ? (
            <p className="text-[13px]" style={{ color: t.muted }}>No revenue recorded yet.</p>
          ) : (
            <div className="rounded-[12px] border overflow-hidden" style={{ background: t.cardBg, borderColor: t.cardBorder }}>
              <div className="overflow-x-auto">
              <div className="min-w-[720px]">
              <div className={`grid ${trendGridCols} gap-2 px-4 py-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase`} style={{ color: t.muted, borderBottom: `1px solid ${t.tableBorder}` }}>
                <span>Period</span><span>Event revenue</span><span>POS revenue</span><span>POS refunds</span><span>Total gross</span><span>Total net</span><span>Days</span>
              </div>
              {trendBuckets.slice().reverse().map((b) => (
                <div key={b.key} className={`grid ${trendGridCols} gap-2 px-4 py-3 text-[13px] items-center`} style={{ borderTop: `1px solid ${t.rowBorder}` }} data-testid="fin-trend-row">
                  <span style={{ color: t.textStrong }} title={b.tooltipLabel}>{b.label}</span>
                  <span style={{ color: b.eventGrossCents > 0 ? t.rev : t.faint }}>{b.eventGrossCents > 0 ? centsToUsd(b.eventGrossCents) : '—'}</span>
                  <span style={{ color: b.posRevenueCents > 0 ? t.pos : t.faint }}>{b.posRevenueCents > 0 ? centsToUsd(b.posRevenueCents) : '—'}</span>
                  <span style={{ color: b.posRefundCents !== 0 ? t.warn : t.faint }}>{b.posRefundCents !== 0 ? centsToUsd(b.posRefundCents) : '—'}</span>
                  <span style={{ color: t.grossText }}>{centsToUsd(b.totalGrossCents)}</span>
                  <span style={{ color: t.rev }}>{centsToUsd(b.totalNetCents)}</span>
                  <span style={{ color: t.mutedStrong }}>{b.days}</span>
                </div>
              ))}
              </div>
              </div>
            </div>
          )}

          <p className="mt-6 text-[12px]" style={{ color: t.faint }}>
            Every calendar day is counted once, whether or not it has a named event — “Event revenue” is TicketTailor +
            manual income tied to an event, “POS revenue” is SpotOn point-of-sale totals for that day (event days and
            plain weekdays alike). Totals are gross before refunds/fees except where noted as net.
          </p>
        </>
      )}

      {tab === 'items' && <ItemAnalytics t={t} />}

      <ManualIncomeDialog
        open={dialogOpen}
        editing={editingEntry}
        defaultDate={dialogDate}
        linkedEvent={linkForEvent}
        theme={theme}
        onClose={closeDialog}
      />
    </div>
  );
}
