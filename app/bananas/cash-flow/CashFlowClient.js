'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { centsToUsd } from '@/lib/event-analytics';
import {
  currentMonthRange,
  filterTransactions,
  monthlyOperatingPnl,
  monthlyTrend,
  summarizeByAccount,
  summarizeByCategory,
  summarizeFinancing,
  summarizeOperating,
  yearToDateRange,
} from '@/lib/financial-ledger';
import AuthenticatedThemeToggleControl from '@/app/components/AuthenticatedThemeToggleControl';
import { CASHFLOW_THEMES as THEMES } from '@/lib/admin-theme';
import { useAuthenticatedTheme } from '@/app/components/AuthenticatedThemeProvider';
import CashFlowTrendChart from './CashFlowTrendChart';
import SpotOnImportDialog from './SpotOnImportDialog';
import SyncTicketTailorButton from './SyncTicketTailorButton';

const SOURCE_LABEL = {
  tickettailor: 'TicketTailor',
  spoton_csv: 'SpotOn CSV',
};

// Badges on the category rollup, so P&L lines are distinguishable from financing
// at a glance. Financing is deliberately neutral-grey: it is not a win or a loss,
// it is capital moving in or out.
const KIND = {
  revenue: { label: 'Revenue', color: (t) => t.rev },
  expense: { label: 'Expense', color: (t) => t.warn },
  financing: { label: 'Financing', color: (t) => t.mutedStrong },
};

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function CashFlowClient({
  accounts,
  transactions,
  batches,
  eventTitles,
  todayIso,
  trendMonths,
  migrationApplied,
}) {
  const { theme, toggleTheme } = useAuthenticatedTheme();
  const t = THEMES[theme];

  const today = useMemo(() => new Date(todayIso), [todayIso]);
  const ytdRange = useMemo(() => yearToDateRange(today), [today]);
  const monthRange = useMemo(() => currentMonthRange(today), [today]);

  const [start, setStart] = useState(ytdRange.start);
  const [end, setEnd] = useState(ytdRange.end);
  const [accountFilter, setAccountFilter] = useState('');
  const [openCategory, setOpenCategory] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  const inRange = useMemo(
    () => filterTransactions(transactions, { start, end }),
    [transactions, start, end],
  );
  const operating = useMemo(() => summarizeOperating(inRange), [inRange]);
  const financing = useMemo(() => summarizeFinancing(inRange), [inRange]);
  const pnlMonths = useMemo(() => monthlyOperatingPnl(inRange, { start, end }), [inRange, start, end]);
  const byAccount = useMemo(() => summarizeByAccount(inRange, accounts), [inRange, accounts]);
  const byCategory = useMemo(() => summarizeByCategory(inRange, accounts), [inRange, accounts]);
  const trend = useMemo(
    () => monthlyTrend(transactions, { months: trendMonths, today }),
    [transactions, trendMonths, today],
  );
  const listed = useMemo(
    () => filterTransactions(transactions, { start, end, accountId: accountFilter || null }),
    [transactions, start, end, accountFilter],
  );

  const batchesById = useMemo(
    () => Object.fromEntries(batches.map((b) => [b.id, b])),
    [batches],
  );

  // The widest per-account inflow sets the bar scale, so the breakdown reads as
  // a comparison rather than every bar sitting at full width.
  const maxAccountFlow = Math.max(
    ...byAccount.map((a) => Math.max(a.inflowCents, a.outflowCents)),
    1,
  );
  const maxCategoryFlow = Math.max(
    ...byCategory.map((c) => Math.max(c.inflowCents, c.outflowCents)),
    1,
  );

  const inputStyle = { background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.inputText };
  const presetStyle = { borderColor: t.ghostBorder, color: t.ghostText };
  const gridCols = 'grid-cols-[92px_1fr_120px_100px_110px]';
  const drillCols = 'grid-cols-[92px_150px_1fr_64px_110px]';
  const pnlCols = 'grid-cols-[1fr_110px_110px_110px_120px]';

  return (
    <div style={{ color: t.text }}
      data-testid="cash-flow">

      <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
        <h1
          className="text-[32px] font-extrabold -tracking-[0.02em] leading-[1.1]"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}
        >
          Cash Flow
        </h1>
        <div className="flex items-center gap-3">
          <div className="text-[11px] tracking-[0.18em]" style={{ color: t.muted }}>OWNER ONLY</div>
          <AuthenticatedThemeToggleControl theme={theme} onToggle={toggleTheme} />
        </div>
      </div>
      <p className="mb-6 text-[14px]" style={{ color: t.muted }}>
        Operating profit and loss first — revenue the business earned less what it spent to operate. Owner
        capital is reported separately under Financing, because money you put in is not money the business
        made. This is not itemized bookkeeping — sales tax, processing fees, and contract splits are not
        deducted, and internal transfers between accounts are excluded throughout.
      </p>

      {!migrationApplied && (
        <div
          className="rounded-[14px] border p-5 mb-8"
          style={{ background: t.warnCardBg, borderColor: t.warnCardBorder }}
        >
          <div className="text-[10px] font-semibold tracking-[0.14em] uppercase mb-2" style={{ color: t.warn }}>
            Ledger tables not found
          </div>
          <p className="text-[13px]" style={{ color: t.mutedStrong }}>
            Apply <code style={{ color: t.textStrong }}>supabase/migrations/20260726_financial_ledger.sql</code> in
            this environment, then sync TicketTailor to populate the dashboard.
          </p>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] font-semibold tracking-[0.12em] uppercase mb-1" style={{ color: t.muted }} htmlFor="cf-start">
              From
            </label>
            <input
              id="cf-start"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="rounded-[8px] px-3 py-2 text-[13px] outline-none"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold tracking-[0.12em] uppercase mb-1" style={{ color: t.muted }} htmlFor="cf-end">
              To
            </label>
            <input
              id="cf-end"
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="rounded-[8px] px-3 py-2 text-[13px] outline-none"
              style={inputStyle}
            />
          </div>
          <button
            type="button"
            onClick={() => { setStart(ytdRange.start); setEnd(ytdRange.end); }}
            className="text-[11px] font-semibold tracking-[0.10em] uppercase rounded-[10px] px-3 py-2 border"
            style={presetStyle}
          >
            Year to date
          </button>
          <button
            type="button"
            onClick={() => { setStart(monthRange.start); setEnd(monthRange.end); }}
            className="text-[11px] font-semibold tracking-[0.10em] uppercase rounded-[10px] px-3 py-2 border"
            style={presetStyle}
          >
            This month
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SyncTicketTailorButton t={t} />
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            data-testid="cf-import-open"
            className="text-[12px] font-semibold tracking-[0.10em] uppercase rounded-[10px] px-4 py-2 border"
            style={{ borderColor: t.ghostBorder, color: t.ghostText }}
          >
            Import SpotOn CSV
          </button>
        </div>
      </div>

      {/* Operating P&L. Financing is deliberately NOT in this group. */}
      <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase mb-3" style={{ color: t.muted }}>
        Profit &amp; loss <span style={{ color: t.faint }}>· operating only</span>
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8" data-testid="cf-pnl-cards">
        {[
          { label: 'Revenue', value: centsToUsd(operating.revenueCents), color: t.rev, testId: 'cf-revenue' },
          { label: 'Operating expenses', value: centsToUsd(operating.expenseCents), color: t.warn, testId: 'cf-expenses' },
          {
            label: 'Net operating income',
            value: centsToUsd(operating.netCents),
            color: operating.netCents < 0 ? t.err : t.rev,
            testId: 'cf-net-operating-income',
          },
          { label: 'P&L transactions', value: operating.counted, color: t.muted },
        ].map((card) => (
          <div
            key={card.label}
            data-testid={card.testId}
            className="rounded-[14px] border p-5"
            style={{ background: t.cardBg, borderColor: t.cardBorder }}
          >
            <div className="text-[10px] font-semibold tracking-[0.14em] uppercase mb-1.5" style={{ color: card.color }}>
              {card.label}
            </div>
            <div className="text-[22px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Running P&L: is the business profitable, and is that improving? */}
      <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase mb-1" style={{ color: t.muted }}>
        Running P&amp;L
      </h2>
      <p className="mb-3 text-[12px]" style={{ color: t.faint }}>
        Operating revenue less operating expenses per month, and the cumulative net across the selected range.
      </p>
      {pnlMonths.length === 0 ? (
        <p className="text-[13px] mb-8" style={{ color: t.muted }}>
          No operating activity in this date range.
        </p>
      ) : (
        <div
          className="rounded-[12px] border overflow-hidden mb-8"
          style={{ background: t.cardBg, borderColor: t.cardBorder }}
          data-testid="cf-running-pnl"
        >
          <div
            className={`grid ${pnlCols} gap-2 px-4 py-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase`}
            style={{ color: t.muted, borderBottom: `1px solid ${t.tableBorder}` }}
          >
            <span>Month</span>
            <span className="text-right">Revenue</span>
            <span className="text-right">Expenses</span>
            <span className="text-right">Net</span>
            <span className="text-right">Cumulative</span>
          </div>
          {pnlMonths.map((month) => (
            <div
              key={month.key}
              className={`grid ${pnlCols} gap-2 px-4 py-3 text-[13px] items-baseline`}
              style={{ borderTop: `1px solid ${t.rowBorder}` }}
            >
              <span style={{ color: t.mutedStrong }}>{month.label}</span>
              <span className="text-right" style={{ color: t.rev }}>{centsToUsd(month.revenueCents)}</span>
              <span className="text-right" style={{ color: t.warn }}>{centsToUsd(month.expenseCents)}</span>
              <span className="text-right font-semibold" style={{ color: month.netCents < 0 ? t.err : t.rev }}>
                {centsToUsd(month.netCents)}
              </span>
              <span
                className="text-right font-extrabold"
                style={{ color: month.cumulativeNetCents < 0 ? t.err : t.rev }}
              >
                {centsToUsd(month.cumulativeNetCents)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Financing — real cash, but never part of the P&L above. */}
      <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase mb-1" style={{ color: t.muted }}>
        Financing <span style={{ color: t.faint }}>· excluded from P&amp;L</span>
      </h2>
      <p className="mb-3 text-[12px]" style={{ color: t.faint }}>
        Capital moving between you and the business. Not revenue, not expense.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8" data-testid="cf-financing-cards">
        {[
          { label: 'Owner contributions', value: centsToUsd(financing.contributionsCents), color: t.mutedStrong, testId: 'cf-owner-contributions' },
          { label: 'Owner draws', value: centsToUsd(financing.distributionsCents), color: t.mutedStrong },
          { label: 'Net financing', value: centsToUsd(financing.netCents), color: t.mutedStrong },
        ].map((card) => (
          <div
            key={card.label}
            data-testid={card.testId}
            className="rounded-[14px] border p-5"
            style={{ background: t.cardBg, borderColor: t.cardBorder }}
          >
            <div className="text-[10px] font-semibold tracking-[0.14em] uppercase mb-1.5" style={{ color: card.color }}>
              {card.label}
            </div>
            <div className="text-[22px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Breakdown by account */}
      <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase mb-3" style={{ color: t.muted }}>
        By account
      </h2>
      {byAccount.length === 0 ? (
        <p className="text-[13px] mb-8" style={{ color: t.muted }}>
          No ledger activity in this date range.
        </p>
      ) : (
        <div className="rounded-[12px] border overflow-hidden mb-8" style={{ background: t.cardBg, borderColor: t.cardBorder }}>
          {byAccount.map((account) => (
            <div key={account.accountId || account.name} className="px-4 py-3.5" style={{ borderTop: `1px solid ${t.rowBorder}` }}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <span className="text-[14px] font-semibold" style={{ color: t.textStrong }}>{account.name}</span>
                <span className="text-[12px]" style={{ color: t.muted }}>
                  <span style={{ color: t.rev }}>{centsToUsd(account.inflowCents)}</span> in ·{' '}
                  <span style={{ color: t.warn }}>{centsToUsd(account.outflowCents)}</span> out ·{' '}
                  <span style={{ color: t.mutedStrong }}>{account.count} {account.count === 1 ? 'row' : 'rows'}</span>
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {[
                  { cents: account.inflowCents, color: t.rev },
                  { cents: account.outflowCents, color: t.warn },
                ].map((bar, i) => (
                  <div key={i} className="h-2 rounded-full overflow-hidden" style={{ background: t.rowBorder }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(bar.cents / maxAccountFlow) * 100}%`, background: bar.color }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Breakdown by category, each row expanding to the rows behind the total */}
      <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase mb-3" style={{ color: t.muted }}>
        By category
      </h2>
      {byCategory.length === 0 ? (
        <p className="text-[13px] mb-8" style={{ color: t.muted }}>
          No ledger activity in this date range.
        </p>
      ) : (
        <div
          className="rounded-[12px] border overflow-hidden mb-8"
          style={{ background: t.cardBg, borderColor: t.cardBorder }}
          data-testid="cf-by-category"
        >
          {byCategory.map((category) => {
            const open = openCategory === category.category;
            return (
              <div key={category.category} style={{ borderTop: `1px solid ${t.rowBorder}` }}>
                <button
                  type="button"
                  onClick={() => setOpenCategory(open ? null : category.category)}
                  aria-expanded={open}
                  className="w-full text-left px-4 py-3.5 transition-opacity hover:opacity-70"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                    <span className="text-[14px] font-semibold" style={{ color: t.textStrong }}>
                      <span aria-hidden="true" className="inline-block w-3 mr-1" style={{ color: t.muted }}>
                        {open ? '▾' : '▸'}
                      </span>
                      {category.category}
                      <span
                        className="ml-2 align-middle text-[9px] font-semibold tracking-[0.10em] uppercase rounded-[4px] px-1.5 py-0.5 border"
                        style={{ color: KIND[category.kind].color(t), borderColor: KIND[category.kind].color(t) }}
                      >
                        {KIND[category.kind].label}
                      </span>
                    </span>
                    <span className="text-[12px]" style={{ color: t.muted }}>
                      <span style={{ color: t.rev }}>{centsToUsd(category.inflowCents)}</span> in ·{' '}
                      <span style={{ color: t.warn }}>{centsToUsd(category.outflowCents)}</span> out ·{' '}
                      <span style={{ color: t.mutedStrong }}>
                        {category.count} {category.count === 1 ? 'row' : 'rows'}
                      </span>
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {[
                      { cents: category.inflowCents, color: t.rev },
                      { cents: category.outflowCents, color: t.warn },
                    ].map((bar, i) => (
                      <div key={i} className="h-2 rounded-full overflow-hidden" style={{ background: t.rowBorder }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(bar.cents / maxCategoryFlow) * 100}%`, background: bar.color }}
                        />
                      </div>
                    ))}
                  </div>
                </button>

                {open && (
                  <div className="pb-1">
                    <div
                      className={`grid ${drillCols} gap-2 px-4 py-2 text-[10px] font-semibold tracking-[0.08em] uppercase`}
                      style={{ color: t.faint, borderTop: `1px solid ${t.rowBorder}` }}
                    >
                      <span>Date</span><span>Account</span><span>Notes</span><span>Dir</span><span className="text-right">Amount</span>
                    </div>
                    {category.transactions.map((txn) => (
                      <div
                        key={txn.id}
                        className={`grid ${drillCols} gap-2 px-4 py-2 text-[12px] items-baseline`}
                        style={{ borderTop: `1px solid ${t.rowBorder}` }}
                      >
                        <span style={{ color: t.mutedStrong }}>{fmtDate(txn.date)}</span>
                        <span className="truncate" style={{ color: t.muted }}>{txn.accountName}</span>
                        <span className="truncate" style={{ color: t.muted }} title={txn.notes || ''}>
                          {txn.notes || '—'}
                        </span>
                        <span style={{ color: txn.direction === 'out' ? t.warn : t.rev }}>
                          {txn.direction === 'out' ? 'Out' : 'In'}
                        </span>
                        <span
                          className="text-right font-semibold"
                          style={{ color: txn.direction === 'out' ? t.warn : t.rev }}
                        >
                          {centsToUsd(txn.amountCents)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <CashFlowTrendChart buckets={trend} t={t} months={trendMonths} />

      {/* Transaction list */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase" style={{ color: t.muted }}>
          Transactions
        </h2>
        <select
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
          aria-label="Filter by account"
          className="rounded-[8px] px-3 py-1.5 text-[12px] outline-none"
          style={inputStyle}
        >
          <option value="">All accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {listed.length === 0 ? (
        <p className="text-[13px]" style={{ color: t.muted }}>No transactions match this filter.</p>
      ) : (
        <div className="rounded-[12px] border overflow-hidden" style={{ background: t.cardBg, borderColor: t.cardBorder }}>
          <div
            className={`grid ${gridCols} gap-2 px-4 py-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase`}
            style={{ color: t.muted, borderBottom: `1px solid ${t.tableBorder}` }}
          >
            <span>Date</span><span>Source</span><span>Category</span><span>Direction</span><span className="text-right">Amount</span>
          </div>
          {listed.map((txn) => {
            const batch = txn.importBatchId ? batchesById[txn.importBatchId] : null;
            return (
              <div
                key={txn.id}
                className={`grid ${gridCols} gap-2 px-4 py-3 text-[13px] items-center`}
                style={{ borderTop: `1px solid ${t.rowBorder}` }}
              >
                <span style={{ color: t.mutedStrong }}>{fmtDate(txn.date)}</span>
                <span className="truncate">
                  {txn.linkedEventId ? (
                    <Link
                      href={`/bananas/events/${txn.linkedEventId}`}
                      className="hover:underline"
                      style={{ color: t.text }}
                      title="Open the source event"
                    >
                      {eventTitles[txn.linkedEventId] || SOURCE_LABEL[txn.source] || txn.source}
                    </Link>
                  ) : (
                    <span style={{ color: t.text }} title={txn.externalRef || ''}>
                      {batch ? batch.filename : SOURCE_LABEL[txn.source] || txn.source}
                    </span>
                  )}
                </span>
                <span style={{ color: t.muted }}>{txn.category || '—'}</span>
                <span style={{ color: txn.direction === 'out' ? t.warn : t.rev }}>
                  {txn.direction === 'out' ? 'Out' : 'In'}
                </span>
                <span
                  className="text-right font-semibold"
                  style={{ color: txn.direction === 'out' ? t.warn : t.rev }}
                >
                  {centsToUsd(txn.amountCents)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-[12px]" style={{ color: t.faint }}>
        TicketTailor rows are recognized on the event date and mirror the cached sales metrics — re-syncing
        updates them in place. SpotOn rows keep their original CSV row in metadata, so a later tips/refunds/fees
        breakdown will not need a re-import.
      </p>

      <SpotOnImportDialog open={importOpen} t={t} onClose={() => setImportOpen(false)} />
    </div>
  );
}
