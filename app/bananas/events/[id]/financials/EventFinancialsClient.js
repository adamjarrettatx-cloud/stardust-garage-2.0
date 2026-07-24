'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';

function usd(cents) {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

const CARD = { background: 'var(--surface-1)', borderColor: 'var(--fg-a06)' };
const LABEL = 'text-[10px] font-semibold tracking-[0.14em] uppercase mb-1.5';

function Row({ label, value, accent }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[13px]" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ color: accent || 'var(--text-1)' }}>{value}</span>
    </div>
  );
}

export default function EventFinancialsClient({ eventId, initial, contracts }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const summary = data.summary;

  // ---- Config form state ----
  const [cpt, setCpt] = useState(String(data.config.tt_cpt_fee_cents ?? 52));
  const [taxBps, setTaxBps] = useState(String(data.config.sales_tax_bps ?? 0));
  const [ccBps, setCcBps] = useState(String(data.config.cc_fee_bps ?? 0));
  const [contractId, setContractId] = useState(data.config.contract_id ?? '');
  const [savingCfg, setSavingCfg] = useState(false);
  const [cfgMsg, setCfgMsg] = useState(null);

  // ---- POS import state ----
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('');
  const [winStart, setWinStart] = useState('');
  const [winEnd, setWinEnd] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState(null);

  async function saveConfig(e) {
    e.preventDefault();
    setSavingCfg(true);
    setCfgMsg(null);
    try {
      const res = await adminFetch(`/api/admin/events/${eventId}/financials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tt_cpt_fee_cents: Number(cpt),
          sales_tax_bps: Number(taxBps),
          cc_fee_bps: Number(ccBps),
          contract_id: contractId || null,
        }),
      });
      setData(res);
      setCfgMsg('Saved');
    } catch (err) {
      setCfgMsg(err?.message || 'Save failed');
    } finally {
      setSavingCfg(false);
    }
  }

  function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result || ''));
    reader.readAsText(file);
  }

  async function importPos(e) {
    e.preventDefault();
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await adminFetch(`/api/admin/events/${eventId}/pos-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv,
          filename,
          windowStart: winStart || null,
          windowEnd: winEnd || null,
          salesTaxBps: Number(taxBps),
          ccFeeBps: Number(ccBps),
        }),
      });
      setImportMsg(`Imported ${res.summary.inWindowCount}/${res.parsedRows} rows in window · ${usd(res.summary.netCents)} net`);
      setCsv('');
      setFilename('');
      // Reload the computed summary with the new batch.
      const fresh = await adminFetch(`/api/admin/events/${eventId}/financials`, { method: 'GET' });
      setData(fresh);
      router.refresh();
    } catch (err) {
      setImportMsg(err?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  async function deleteBatch(batchId) {
    try {
      await adminFetch(`/api/admin/events/${eventId}/pos-import?batchId=${batchId}`, { method: 'DELETE' });
      const fresh = await adminFetch(`/api/admin/events/${eventId}/financials`, { method: 'GET' });
      setData(fresh);
      router.refresh();
    } catch (err) {
      setImportMsg(err?.message || 'Delete failed');
    }
  }

  const [snapshotting, setSnapshotting] = useState(false);
  const [snapshotMsg, setSnapshotMsg] = useState(null);

  async function takeSnapshot() {
    setSnapshotting(true);
    setSnapshotMsg(null);
    try {
      const res = await adminFetch(`/api/admin/events/${eventId}/financials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'snapshot' }),
      });
      setData(res);
      setSnapshotMsg('Snapshot saved');
    } catch (err) {
      setSnapshotMsg(err?.message || 'Snapshot failed');
    } finally {
      setSnapshotting(false);
    }
  }

  const noMetrics = !data.metrics || data.metricsStatus !== 'ok';
  const warning = data.warning;
  const canSnapshot = !!data.contract && (
    data.contract.stardust_split_percent != null || data.contract.flat_fee_cents != null
  );

  return (
    <div className="space-y-10">
      {/* Contract-terms warning — surfaces when no resolved contract terms are
          driving the split (e.g. the linked contract was deleted), so the calc
          is silently defaulting to 100% Stardust. */}
      {warning && (
        <div
          className="rounded-[12px] border p-4 text-[13px]"
          style={{ background: 'var(--st-tint-amber-1)', borderColor: 'rgba(248,113,113,0.35)', color: 'var(--st-fca5a5)' }}
          role="alert"
        >
          <span className="font-semibold tracking-[0.04em] uppercase text-[11px] block mb-1" style={{ color: 'var(--st-f87171)' }}>
            {warning.kind === 'missing_contract_link' ? 'Contract missing' : 'No contract terms'}
          </span>
          {warning.message}
        </div>
      )}

      {/* Headline split */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Stardust share', value: usd(summary.totals.stardustCents), accent: 'var(--st-4ade80)', bg: 'var(--st-tint-green-1)', border: 'rgba(74,222,128,0.22)' },
          { label: 'Counterparty share', value: usd(summary.totals.counterpartyCents), accent: 'var(--st-f472b6)', bg: 'var(--st-tint-pink-1)', border: 'rgba(244,114,182,0.22)' },
          { label: 'Total event profit', value: usd(summary.totals.totalEventProfitCents), accent: 'var(--st-ffb84d)', bg: 'var(--st-tint-amber-3)', border: 'rgba(255,184,77,0.22)' },
        ].map((c) => (
          <div key={c.label} className="rounded-[14px] border p-5" style={{ background: c.bg, borderColor: c.border }}>
            <div className={LABEL} style={{ color: c.accent }}>{c.label}</div>
            <div className="text-[26px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{c.value}</div>
          </div>
        ))}
      </div>

      {noMetrics && (
        <div className="rounded-[12px] border p-4 text-[13px]" style={{ background: 'var(--st-tint-amber-3)', borderColor: 'rgba(255,184,77,0.25)', color: 'var(--text-2)' }}>
          No cached TicketTailor metrics for this event yet — ticket figures show $0 until you link a TT
          series and refresh metrics. POS and contract terms still apply.
        </div>
      )}

      {/* Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-[14px] border p-5" style={CARD}>
          <div className={LABEL} style={{ color: 'var(--text-3)' }}>TicketTailor (ticket sales)</div>
          <Row label="Tickets sold" value={summary.tickets.sold} />
          <Row label="Gross" value={usd(summary.tickets.grossCents)} />
          <Row label="Processor fees" value={`- ${usd(summary.tickets.processorFeesCents)}`} />
          <Row label={`CPT fee (${usd(summary.tickets.cptFeeCents)}/ticket)`} value={`- ${usd(summary.tickets.cptTotalCents)}`} />
          <Row label="TT net" value={usd(summary.tickets.netCents)} accent="var(--st-4ade80)" />
        </div>
        <div className="rounded-[14px] border p-5" style={CARD}>
          <div className={LABEL} style={{ color: 'var(--text-3)' }}>POS (imported CSV)</div>
          <Row label="Batches" value={summary.pos.batches} />
          <Row label="Gross" value={usd(summary.pos.grossCents)} />
          <Row label="Sales tax" value={`- ${usd(summary.pos.taxCents)}`} />
          <Row label="Card fees" value={`- ${usd(summary.pos.ccFeeCents)}`} />
          <Row label="POS net" value={usd(summary.pos.netCents)} accent="var(--st-4ade80)" />
        </div>
      </div>

      {/* Split detail */}
      <div className="rounded-[14px] border p-5" style={CARD}>
        <div className={LABEL} style={{ color: 'var(--text-3)' }}>Contract split (applied to TT net ticket profit)</div>
        {data.contract ? (
          <>
            <Row label="Stardust split %" value={`${summary.split.stardustPercent}%`} />
            <Row label="Flat fee to counterparty" value={usd(summary.split.flatFeeCents)} />
            <Row label="Stardust ticket share" value={usd(summary.split.ticketStardustShareCents)} accent="var(--st-4ade80)" />
            <Row label="Counterparty ticket share" value={usd(summary.split.ticketCounterpartyShareCents)} accent="var(--st-f472b6)" />
            <p className="mt-3 text-[11px]" style={{ color: 'var(--text-4)' }}>
              Terms source: {data.contract.financial_terms_source}. Edit on the{' '}
              <a href={`/bananas/documents/${data.contract.document_id}`} className="underline" style={{ color: 'var(--st-ffb84d)' }}>contract page</a>.
            </p>
            {canSnapshot && (
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={takeSnapshot}
                  disabled={snapshotting}
                  className="text-[11px] font-semibold tracking-[0.10em] uppercase rounded-[8px] px-3 py-1.5 disabled:opacity-50"
                  style={{ border: '1px solid rgba(255,184,77,0.4)', color: 'var(--st-ffb84d)' }}
                >
                  {snapshotting ? 'Saving…' : data.snapshot ? 'Re-save terms snapshot' : 'Save terms snapshot'}
                </button>
                {snapshotMsg && <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>{snapshotMsg}</span>}
                <span className="text-[11px]" style={{ color: 'var(--text-4)' }}>
                  Preserves these terms so deleting the contract won’t change this event’s books.
                </span>
              </div>
            )}
          </>
        ) : data.snapshot ? (
          <>
            <Row label="Stardust split %" value={`${summary.split.stardustPercent}%`} />
            <Row label="Flat fee to counterparty" value={usd(summary.split.flatFeeCents)} />
            <Row label="Stardust ticket share" value={usd(summary.split.ticketStardustShareCents)} accent="var(--st-4ade80)" />
            <Row label="Counterparty ticket share" value={usd(summary.split.ticketCounterpartyShareCents)} accent="var(--st-f472b6)" />
            <p className="mt-3 text-[11px]" style={{ color: 'var(--text-4)' }}>
              Using a saved snapshot of reviewed contract terms (no live contract linked). Re-link a
              contract below to resume live terms.
            </p>
          </>
        ) : (
          <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
            No contract linked to this event. With no split terms, Stardust keeps 100% of ticket net.
            Link a contract below or attach one on a document’s contract page.
          </p>
        )}
      </div>

      {/* Config form */}
      <form onSubmit={saveConfig} className="rounded-[14px] border p-5 space-y-4" style={CARD}>
        <div className={LABEL} style={{ color: 'var(--text-3)' }}>Fee configuration</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="block text-[12px]" style={{ color: 'var(--text-2)' }}>
            CPT fee (cents/ticket)
            <input type="number" min="0" value={cpt} onChange={(e) => setCpt(e.target.value)}
              className="mt-1 w-full rounded-[8px] px-3 py-2 text-[14px]" style={{ background: 'var(--surface-3)', border: '1px solid var(--fg-a1)', color: 'white' }} />
          </label>
          <label className="block text-[12px]" style={{ color: 'var(--text-2)' }}>
            Sales tax (basis pts)
            <input type="number" min="0" max="10000" value={taxBps} onChange={(e) => setTaxBps(e.target.value)}
              className="mt-1 w-full rounded-[8px] px-3 py-2 text-[14px]" style={{ background: 'var(--surface-3)', border: '1px solid var(--fg-a1)', color: 'white' }} />
          </label>
          <label className="block text-[12px]" style={{ color: 'var(--text-2)' }}>
            Card fee (basis pts)
            <input type="number" min="0" max="10000" value={ccBps} onChange={(e) => setCcBps(e.target.value)}
              className="mt-1 w-full rounded-[8px] px-3 py-2 text-[14px]" style={{ background: 'var(--surface-3)', border: '1px solid var(--fg-a1)', color: 'white' }} />
          </label>
        </div>
        <label className="block text-[12px]" style={{ color: 'var(--text-2)' }}>
          Split contract
          <select value={contractId} onChange={(e) => setContractId(e.target.value)}
            className="mt-1 w-full rounded-[8px] px-3 py-2 text-[14px]" style={{ background: 'var(--surface-3)', border: '1px solid var(--fg-a1)', color: 'white' }}>
            <option value="">Auto (most recent signed)</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.status} · {c.stardust_split_percent != null ? `${c.stardust_split_percent}% Stardust` : 'no split'} ({c.financial_terms_source})
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={savingCfg}
            className="text-[12px] font-semibold tracking-[0.10em] uppercase rounded-[10px] px-4 py-2 disabled:opacity-50" style={{ background: 'var(--st-ffb84d)', color: 'var(--surface-1)' }}>
            {savingCfg ? 'Saving…' : 'Save config'}
          </button>
          {cfgMsg && <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>{cfgMsg}</span>}
        </div>
        <p className="text-[11px]" style={{ color: 'var(--text-4)' }}>
          Tip: 8.25% sales tax = 825 basis points. The default CPT fee is 52¢ ($0.52) per TicketTailor ticket sold.
        </p>
      </form>

      {/* POS import */}
      <form onSubmit={importPos} className="rounded-[14px] border p-5 space-y-4" style={CARD}>
        <div className={LABEL} style={{ color: 'var(--text-3)' }}>Import POS CSV</div>
        <input type="file" accept=".csv,text/csv" onChange={onFile}
          className="block text-[13px]" style={{ color: 'var(--text-2)' }} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block text-[12px]" style={{ color: 'var(--text-2)' }}>
            Window start <span style={{ color: 'var(--text-4)' }}>(venue time, CT — inclusive)</span>
            <input type="datetime-local" value={winStart} onChange={(e) => setWinStart(e.target.value)}
              className="mt-1 w-full rounded-[8px] px-3 py-2 text-[14px]" style={{ background: 'var(--surface-3)', border: '1px solid var(--fg-a1)', color: 'white' }} />
          </label>
          <label className="block text-[12px]" style={{ color: 'var(--text-2)' }}>
            Window end <span style={{ color: 'var(--text-4)' }}>(venue time, CT — exclusive)</span>
            <input type="datetime-local" value={winEnd} onChange={(e) => setWinEnd(e.target.value)}
              className="mt-1 w-full rounded-[8px] px-3 py-2 text-[14px]" style={{ background: 'var(--surface-3)', border: '1px solid var(--fg-a1)', color: 'white' }} />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={importing || !csv}
            className="text-[12px] font-semibold tracking-[0.10em] uppercase rounded-[10px] px-4 py-2 disabled:opacity-50" style={{ background: 'var(--st-4ade80)', color: 'var(--surface-3)' }}>
            {importing ? 'Importing…' : 'Import CSV'}
          </button>
          {importMsg && <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>{importMsg}</span>}
        </div>
        <p className="text-[11px]" style={{ color: 'var(--text-4)' }}>
          Recognized columns (case-insensitive): timestamp/date, gross/total, tax, fees, net, description.
          Window times are interpreted as venue-local (Central). The window is half-open — a row exactly on the
          end time is excluded — so back-to-back events never double-count a boundary transaction. Leave the window
          blank to count all rows.
        </p>
      </form>

      {/* Existing batches */}
      {data.posBatches.length > 0 && (
        <div className="rounded-[14px] border overflow-hidden" style={CARD}>
          <div className="px-5 py-3 text-[10px] font-semibold tracking-[0.14em] uppercase" style={{ color: 'var(--text-3)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            POS import batches
          </div>
          {data.posBatches.map((b) => (
            <div key={b.id} className="px-5 py-3 flex items-center justify-between text-[13px]" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <span className="truncate" style={{ color: 'var(--text-2)' }}>
                {b.source_filename || 'import'} · {b.in_window_count} rows · {usd(b.net_cents)} net
              </span>
              <button type="button" onClick={() => deleteBatch(b.id)} className="text-[11px] uppercase tracking-[0.1em]" style={{ color: 'var(--st-f472b6)' }}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
