'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import { DOCUMENTS_THEMES as THEMES } from '@/lib/admin-theme';
import { useAuthenticatedTheme } from '@/app/components/AuthenticatedThemeProvider';

// Manages the structured financial terms attached to a contract. Two paths:
//   1. Deterministic extraction (POST) — regex heuristics over pasted text or a
//      stored .txt/.md version. Contract text is NOT sent to any external AI.
//   2. Manual override (PUT) — the admin confirms/edits the split %, flat fee,
//      and recipient. Marks the source so a later extraction won't clobber it.
export default function ContractFinancialsPanel({ documentId, initial }) {
  const router = useRouter();
  const { theme } = useAuthenticatedTheme();
  const t = THEMES[theme];
  const [terms, setTerms] = useState(initial);
  const [pasteText, setPasteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const [split, setSplit] = useState(initial?.stardust_split_percent ?? '');
  const [flatFee, setFlatFee] = useState(
    initial?.flat_fee_cents != null ? String(initial.flat_fee_cents / 100) : '',
  );
  const [recipient, setRecipient] = useState(initial?.revenue_share_recipient || 'stardust');

  const inputStyle = { background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.inputText };

  async function extract() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const json = await adminFetch(`/api/admin/documents/${documentId}/contract/financials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pasteText ? { text: pasteText } : {}),
      });
      const e = json.extracted;
      setMsg(`Detected: ${e.matched.length ? e.matched.join(', ') : 'nothing'}.${json.applied ? ' Applied to terms.' : ' Manual values kept.'}`);
      if (json.applied) {
        if (e.stardustSplitPercent != null) setSplit(String(e.stardustSplitPercent));
        if (e.flatFeeCents != null) setFlatFee(String(e.flatFeeCents / 100));
        setRecipient(e.revenueShareRecipient);
      }
      router.refresh();
    } catch (e) {
      setErr(e?.message || 'Extraction failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveOverride() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const json = await adminFetch(`/api/admin/documents/${documentId}/contract/financials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stardust_split_percent: split === '' ? null : Number(split),
          flat_fee_cents: flatFee === '' ? null : Math.round(Number(flatFee) * 100),
          revenue_share_recipient: recipient,
        }),
      });
      setTerms(json.contract);
      setMsg('Terms saved.');
      router.refresh();
    } catch (e) {
      setErr(e?.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[14px] border p-5 mb-6" style={{ background: t.cardBg, borderColor: t.cardBorder }}>
      <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase mb-4" style={{ color: t.muted }}>
        Financial Terms
      </h2>

      {err && (
        <div className="mb-4 p-3 rounded-[10px] text-[13px]" style={{ background: t.dangerBg, border: `1px solid ${t.dangerBorder}`, color: t.dangerText }}>{err}</div>
      )}
      {msg && (
        <div className="mb-4 p-3 rounded-[10px] text-[13px]" style={{ background: t.successBg, border: `1px solid ${t.successBorder}`, color: t.successText }}>{msg}</div>
      )}

      <p className="text-[12px] mb-2" style={{ color: t.faint }}>
        Paste contract text to auto-detect terms (50% net split, $500 flat fee, sales tax). Text stays on
        our servers — nothing is sent to external AI. You can also enter terms manually below.
      </p>
      <textarea
        value={pasteText}
        onChange={(e) => setPasteText(e.target.value)}
        rows={3}
        placeholder="Paste relevant contract text (optional)…"
        className="w-full px-3 py-2.5 text-[13px] rounded-[10px] outline-none resize-none mb-2"
        style={inputStyle}
      />
      <button onClick={extract} disabled={busy}
        className="text-[12px] px-3 py-1.5 rounded-[8px] mb-5" style={{ border: `1px solid ${t.ghostBorder}`, color: t.ghostText, opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Working…' : 'Auto-detect terms'}
      </button>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <label className="text-[12px]" style={{ color: t.muted }}>
          Stardust split %
          <input type="number" min="0" max="100" value={split} onChange={(e) => setSplit(e.target.value)}
            placeholder="(none = 100%)"
            className="mt-1 w-full px-3 py-2.5 text-[14px] rounded-[10px] outline-none" style={inputStyle} />
        </label>
        <label className="text-[12px]" style={{ color: t.muted }}>
          Flat fee ($)
          <input type="number" min="0" step="0.01" value={flatFee} onChange={(e) => setFlatFee(e.target.value)}
            placeholder="0.00"
            className="mt-1 w-full px-3 py-2.5 text-[14px] rounded-[10px] outline-none" style={inputStyle} />
        </label>
        <label className="text-[12px]" style={{ color: t.muted }}>
          Recipient
          <select value={recipient} onChange={(e) => setRecipient(e.target.value)}
            className="mt-1 w-full px-3 py-2.5 text-[14px] rounded-[10px] outline-none cursor-pointer" style={inputStyle}>
            <option value="stardust">stardust</option>
            <option value="counterparty">counterparty</option>
            <option value="split">split</option>
          </select>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={saveOverride} disabled={busy}
          className="px-5 py-2 text-[13px] font-semibold rounded-[10px] tracking-[0.06em] uppercase" style={{ background: t.solidBg, color: t.solidText, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Saving…' : 'Save terms'}
        </button>
        {terms?.financial_terms_source && terms.financial_terms_source !== 'none' && (
          <span className="text-[11px]" style={{ color: t.faint }}>Source: {terms.financial_terms_source}</span>
        )}
      </div>
    </div>
  );
}
