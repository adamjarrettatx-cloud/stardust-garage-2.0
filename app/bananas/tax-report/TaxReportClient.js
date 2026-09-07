'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

// ---- helpers ----------------------------------------------------------------
const money = (cents) =>
  ((Number(cents) || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// Default the report to the current calendar quarter, since that's the
// filing cadence for Texas sales tax for most small filers.
function currentQuarterRange(now = new Date()) {
  const y = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3); // 0..3
  const startMonth = q * 3;
  const start = new Date(Date.UTC(y, startMonth, 1));
  const end = new Date(Date.UTC(y, startMonth + 3, 0)); // last day of quarter
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(end), label: `Q${q + 1} ${y}` };
}

// Convert the fetched report into a CSV so the owner can drop it into their
// tax-prep spreadsheet or hand it to their bookkeeper.
function toCsv(rows) {
  if (!rows || !rows.length) return 'month,tax_collected_usd,tax_refunded_usd,net_tax_owed_usd,orders_count\n';
  const header = 'month,tax_collected_usd,tax_refunded_usd,net_tax_owed_usd,orders_count';
  const lines = rows.map((r) =>
    [
      r.month,
      ((r.tax_collected_cents || 0) / 100).toFixed(2),
      ((r.tax_refunded_cents || 0) / 100).toFixed(2),
      ((r.net_tax_owed_cents || 0) / 100).toFixed(2),
      r.orders_count || 0,
    ].join(','),
  );
  return [header, ...lines].join('\n');
}

// ---- component --------------------------------------------------------------
export default function TaxReportClient() {
  const defaults = useMemo(() => currentQuarterRange(), []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const r = await fetch(`/api/admin/tickets/tax-report?${params.toString()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const downloadCsv = () => {
    if (!data) return;
    const csv = toCsv(data.by_month);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sdg-tax-report-${from || 'start'}-to-${to || 'end'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const cardStyle = {
    background: 'var(--auth-card-bg)',
    borderColor: 'var(--auth-card-border)',
    color: 'var(--auth-text-primary)',
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  };
  const pillStyle = {
    background: 'var(--auth-card-bg-alt)',
    borderColor: 'var(--auth-card-border-strong)',
    color: 'var(--auth-text-primary)',
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  };

  return (
    <div className="p-8 space-y-6" style={{ background: 'var(--auth-page-bg)', minHeight: '100vh', color: 'var(--auth-text-primary)' }}>
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Texas sales-tax report
        </h1>
        <p style={{ color: 'var(--auth-muted)' }}>
          Internal-ticketing orders only. Windows on the date the buyer paid.
          Refunded tax is subtracted from what SDG owes the state.
        </p>
      </header>

      {/* Date range + actions */}
      <section className="flex flex-wrap items-end gap-3 rounded-2xl border p-4" style={cardStyle}>
        <label className="flex flex-col text-sm">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                 className="mt-1 rounded-full border px-3 py-2" style={pillStyle} />
        </label>
        <label className="flex flex-col text-sm">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                 className="mt-1 rounded-full border px-3 py-2" style={pillStyle} />
        </label>
        <div className="flex gap-2">
          {['Q1', 'Q2', 'Q3', 'Q4'].map((label, i) => {
            const y = new Date().getUTCFullYear();
            const start = new Date(Date.UTC(y, i * 3, 1)).toISOString().slice(0, 10);
            const end = new Date(Date.UTC(y, i * 3 + 3, 0)).toISOString().slice(0, 10);
            return (
              <button key={label} type="button" onClick={() => { setFrom(start); setTo(end); }}
                      className="rounded-full border px-3 py-2 text-sm" style={pillStyle}>
                {label} {y}
              </button>
            );
          })}
          <button type="button" onClick={load} disabled={loading}
                  className="rounded-full border px-4 py-2 text-sm font-medium" style={pillStyle}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button type="button" onClick={downloadCsv} disabled={!data}
                  className="rounded-full border px-4 py-2 text-sm font-medium" style={pillStyle}>
            Export CSV
          </button>
        </div>
      </section>

      {err && (
        <div className="rounded-2xl border p-4" style={{ ...cardStyle, borderColor: 'rgba(239,68,68,0.5)', color: '#fca5a5' }}>
          {err}
        </div>
      )}

      {/* Totals */}
      {data && (
        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border p-5" style={cardStyle}>
            <div className="text-sm" style={{ color: 'var(--auth-muted)' }}>Tax collected</div>
            <div className="text-3xl font-semibold mt-1">{money(data.totals.tax_collected_cents)}</div>
          </div>
          <div className="rounded-2xl border p-5" style={cardStyle}>
            <div className="text-sm" style={{ color: 'var(--auth-muted)' }}>Tax refunded</div>
            <div className="text-3xl font-semibold mt-1">−{money(data.totals.tax_refunded_cents)}</div>
          </div>
          <div className="rounded-2xl border p-5" style={{ ...cardStyle, borderColor: 'var(--auth-card-border-strong)' }}>
            <div className="text-sm" style={{ color: 'var(--auth-muted)' }}>Net tax owed (TX)</div>
            <div className="text-3xl font-semibold mt-1">{money(data.totals.net_tax_owed_cents)}</div>
            <div className="text-xs mt-1" style={{ color: 'var(--auth-muted)' }}>
              {data.totals.orders_count} order{data.totals.orders_count === 1 ? '' : 's'} · gross {money(data.totals.gross_cents)}
            </div>
          </div>
        </section>
      )}

      {/* By month */}
      {data && data.by_month.length > 0 && (
        <section className="rounded-2xl border p-5" style={cardStyle}>
          <h2 className="text-lg font-semibold mb-3">By month</h2>
          <table className="w-full text-sm">
            <thead style={{ color: 'var(--auth-muted)' }}>
              <tr className="text-left border-b" style={{ borderColor: 'var(--auth-card-border)' }}>
                <th className="py-2">Month</th>
                <th className="py-2 text-right">Collected</th>
                <th className="py-2 text-right">Refunded</th>
                <th className="py-2 text-right">Net owed</th>
                <th className="py-2 text-right">Orders</th>
              </tr>
            </thead>
            <tbody>
              {data.by_month.map((m) => (
                <tr key={m.month} className="border-b" style={{ borderColor: 'var(--auth-card-border)' }}>
                  <td className="py-2">{m.month}</td>
                  <td className="py-2 text-right">{money(m.tax_collected_cents)}</td>
                  <td className="py-2 text-right">{money(m.tax_refunded_cents)}</td>
                  <td className="py-2 text-right font-medium">{money(m.net_tax_owed_cents)}</td>
                  <td className="py-2 text-right">{m.orders_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* By event */}
      {data && data.by_event.length > 0 && (
        <section className="rounded-2xl border p-5" style={cardStyle}>
          <h2 className="text-lg font-semibold mb-3">By event</h2>
          <table className="w-full text-sm">
            <thead style={{ color: 'var(--auth-muted)' }}>
              <tr className="text-left border-b" style={{ borderColor: 'var(--auth-card-border)' }}>
                <th className="py-2">Event</th>
                <th className="py-2">Date</th>
                <th className="py-2 text-right">Collected</th>
                <th className="py-2 text-right">Refunded</th>
                <th className="py-2 text-right">Net owed</th>
                <th className="py-2 text-right">Orders</th>
              </tr>
            </thead>
            <tbody>
              {data.by_event.map((e) => (
                <tr key={e.event_id || e.title} className="border-b" style={{ borderColor: 'var(--auth-card-border)' }}>
                  <td className="py-2">{e.title}</td>
                  <td className="py-2" style={{ color: 'var(--auth-muted)' }}>{e.event_date || '—'}</td>
                  <td className="py-2 text-right">{money(e.tax_collected_cents)}</td>
                  <td className="py-2 text-right">{money(e.tax_refunded_cents)}</td>
                  <td className="py-2 text-right font-medium">{money(e.net_tax_owed_cents)}</td>
                  <td className="py-2 text-right">{e.orders_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {data && data.totals.orders_count === 0 && (
        <div className="rounded-2xl border p-8 text-center" style={cardStyle}>
          <p style={{ color: 'var(--auth-muted)' }}>
            No internal-ticketing orders in this window. TicketTailor orders do not
            appear here — TicketTailor is the merchant of record on those.
          </p>
        </div>
      )}
    </div>
  );
}
