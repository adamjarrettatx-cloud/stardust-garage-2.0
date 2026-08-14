'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import { createClient } from '@/lib/supabase/client';
import { centsToUsd } from '@/lib/event-analytics';
import { AGGREGATION, SPOTON_FIELDS, validateMapping } from '@/lib/spoton-import';

// Owner-only SpotOn POS CSV importer: upload -> map columns -> confirm.
//
// The upload step only stages the file (the server parses it and keeps the rows
// as a 'pending' batch); nothing reaches the ledger until confirm. The mapping
// step never assumes a layout: the server suggests a mapping from the detected
// headers and every field can be re-pointed or left unmapped. The same
// validateMapping() the server enforces runs here so the admin sees the problem
// before submitting.
//
// SpotOn's item-level export is one row per sold item, so the server also
// suggests how rows become ledger rows: summed per calendar date, or straight
// through for an export that is already daily. Both stay selectable.
const FIELD_GROUPS = [
  { title: 'Amount', kinds: ['date', 'amount'] },
  { title: 'Breakdown — captured in metadata, never added to the amount', kinds: ['breakdown', 'dimension', 'flag'] },
];

export default function SpotOnImportDialog({ open, t, onClose }) {
  const router = useRouter();

  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [aggregation, setAggregation] = useState(AGGREGATION.row);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [duplicateAck, setDuplicateAck] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (open) return undefined;
    setFile(null);
    setPreview(null);
    setMapping({});
    setAggregation(AGGREGATION.row);
    setError(null);
    setDuplicateAck(false);
    setResult(null);
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !busy) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, busy, preview, result]);

  if (!open) return null;

  // Closing before confirming discards the staged batch so pending uploads
  // don't accumulate. Best-effort: a failed cleanup must not block the close.
  async function close() {
    if (preview?.batchId && !result) {
      try {
        await adminFetch('/api/admin/financial-ledger/spoton-import', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchId: preview.batchId }),
        });
      } catch {
        // The batch stays 'pending' and is simply ignored by the dashboard.
      }
    }
    onClose();
  }

  async function upload(e) {
    e.preventDefault();
    if (!file) { setError('Choose a CSV file first.'); return; }
    setBusy(true);
    setError(null);
    try {
      // Large exports (year-to-date SpotOn pulls can run well past 4-5MB)
      // can't ride along in a single serverless-function request body, so the
      // file goes browser -> Supabase Storage directly via a signed upload
      // URL, and only a small JSON pointer to it goes to our own API.
      const signed = await adminFetch('/api/admin/financial-ledger/spoton-import/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(signed.bucket)
        .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type || 'text/csv' });
      if (uploadError) throw new Error(uploadError.message || 'Could not upload the file to storage.');

      const res = await adminFetch('/api/admin/financial-ledger/spoton-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath: signed.path, filename: file.name }),
      });
      setPreview(res);
      setMapping(res.suggestedMapping || {});
      setAggregation(res.suggestedAggregation || AGGREGATION.row);
    } catch (err) {
      setError(err?.message || 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/financial-ledger/spoton-import', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: preview.batchId, mapping, aggregation, force: duplicateAck }),
      });
      setResult(res);
      router.refresh();
    } catch (err) {
      setError(err?.message || 'Could not import that file.');
    } finally {
      setBusy(false);
    }
  }

  const check = preview ? validateMapping(mapping, preview.headers) : { valid: false, errors: {} };
  const blockedByDuplicate = Boolean(preview?.duplicateOf) && !duplicateAck;

  const inputStyle = { background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.inputText };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: t.overlay }}
      onClick={() => { if (!busy) close(); }}
      data-testid="cf-spoton-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import SpotOn CSV"
        className="w-full sm:max-w-[720px] rounded-t-[16px] sm:rounded-[16px] border p-5 max-h-[92vh] overflow-y-auto"
        style={{ background: t.cardBg, borderColor: t.cardBorder, color: t.text }}
        onClick={(e) => e.stopPropagation()}
        data-testid="cf-spoton-dialog"
      >
        <div className="flex items-center justify-between mb-4">
          <h2
            className="text-[18px] font-extrabold"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}
          >
            Import SpotOn CSV
          </h2>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="text-[12px] tracking-[0.10em] uppercase disabled:opacity-50"
            style={{ color: t.muted }}
          >
            Close
          </button>
        </div>

        {error && (
          <div className="rounded-[10px] px-3 py-2 mb-4 text-[13px]" style={{ background: t.errBg, color: t.err }}>
            {error}
          </div>
        )}

        {/* Step 3 — done */}
        {result ? (
          <div>
            <div
              className="rounded-[12px] border p-4 mb-4"
              style={{ background: t.revCardBg, borderColor: t.revCardBorder }}
            >
              <div className="text-[13px] font-semibold mb-1" style={{ color: t.rev }}>
                {result.aggregation === AGGREGATION.daily
                  ? `Imported ${result.imported} daily ${result.imported === 1 ? 'row' : 'rows'} from ${result.lineItems.toLocaleString('en-US')} line items`
                  : `Imported ${result.imported} ${result.imported === 1 ? 'row' : 'rows'}`}
              </div>
              <div className="text-[12px]" style={{ color: t.mutedStrong }}>
                {centsToUsd(result.inflowCents)} in
                {result.outflowCents > 0 && ` · ${centsToUsd(result.outflowCents)} out`}
                {result.skippedZero > 0 && (result.aggregation === AGGREGATION.daily
                  ? ` · ${result.skippedZero} dates summed to zero and were skipped`
                  : ` · ${result.skippedZero} zero-amount rows skipped`)}
                {result.unparseable > 0 && ` · ${result.unparseable} rows had no readable date`}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-[12px] font-semibold tracking-[0.10em] uppercase rounded-[10px] px-4 py-2"
              style={{ background: t.btnBg, color: t.btnText }}
            >
              Done
            </button>
          </div>
        ) : !preview ? (
          /* Step 1 — upload */
          <form onSubmit={upload}>
            <p className="text-[13px] mb-4" style={{ color: t.muted }}>
              Upload a SpotOn export (.csv, up to 25MB — a full year of item-level data included). The file is
              parsed and previewed here — nothing is written to the ledger until you confirm the column mapping
              on the next step.
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => { setFile(e.target.files?.[0] || null); setError(null); }}
              className="w-full rounded-[8px] px-3 py-2 text-[13px] mb-4"
              style={inputStyle}
              data-testid="cf-spoton-file"
            />
            <button
              type="submit"
              disabled={busy || !file}
              className="text-[12px] font-semibold tracking-[0.10em] uppercase rounded-[10px] px-4 py-2 disabled:opacity-50"
              style={{ background: t.btnBg, color: t.btnText }}
            >
              {busy ? 'Reading…' : 'Preview'}
            </button>
          </form>
        ) : (
          /* Step 2 — map columns */
          <div>
            <p className="text-[13px] mb-1" style={{ color: t.mutedStrong }}>
              <strong style={{ color: t.textStrong }}>{preview.filename}</strong> · {preview.rowCount}{' '}
              {preview.rowCount === 1 ? 'row' : 'rows'} · {preview.headers.length} columns
            </p>
            <p className="text-[12px] mb-4" style={{ color: t.muted }}>
              Map each ledger field to a column. Date is required, plus one of net deposit, net sales, or gross
              sales. Amounts are recomputed on the server from the uploaded rows.
            </p>

            {/* How rows become ledger rows. Pre-selected from the detected shape. */}
            <fieldset className="rounded-[10px] border p-3 mb-4" style={{ borderColor: t.tableBorder }}>
              <legend className="text-[11px] font-semibold tracking-[0.08em] uppercase px-1" style={{ color: t.muted }}>
                Ledger rows
              </legend>
              {preview.itemized && (
                <p className="text-[11px] mb-2" style={{ color: t.rev }}>
                  Detected an item-level export (one row per sold item), so these rows are summed per day.
                </p>
              )}
              {[
                {
                  value: AGGREGATION.daily,
                  label: 'One row per calendar date',
                  hint: 'Sums the mapped amount across every line item of a day. Taxes, discounts, gross, per-category subtotals, and void/refund counts are kept in metadata.',
                },
                {
                  value: AGGREGATION.row,
                  label: 'One row per CSV row',
                  hint: 'For an export that is already daily or batch level.',
                },
              ].map((option) => (
                <label key={option.value} className="flex items-start gap-2 text-[12px] mb-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="cf-spoton-aggregation"
                    value={option.value}
                    checked={aggregation === option.value}
                    onChange={() => setAggregation(option.value)}
                    className="mt-0.5"
                  />
                  <span>
                    <span style={{ color: t.textStrong }}>{option.label}</span>
                    <span className="block text-[10px]" style={{ color: t.faint }}>{option.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {preview.duplicateOf && (
              <label
                className="flex items-start gap-2 rounded-[10px] border p-3 mb-4 text-[12px] cursor-pointer"
                style={{ background: t.warnCardBg, borderColor: t.warnCardBorder, color: t.mutedStrong }}
              >
                <input
                  type="checkbox"
                  checked={duplicateAck}
                  onChange={(e) => setDuplicateAck(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  This exact file was already imported as{' '}
                  <strong style={{ color: t.warn }}>{preview.duplicateOf.filename}</strong>. Tick to import it
                  again anyway.
                </span>
              </label>
            )}

            {FIELD_GROUPS.map((group) => (
              <div key={group.title} className="mb-5">
                <h3
                  className="text-[11px] font-semibold tracking-[0.10em] uppercase mb-2"
                  style={{ color: t.muted }}
                >
                  {group.title}
                </h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  {SPOTON_FIELDS.filter((f) => group.kinds.includes(f.kind)).map((field) => (
                    <div key={field.key}>
                      <label
                        className="block text-[11px] font-semibold tracking-[0.08em] uppercase mb-1"
                        style={{ color: t.muted }}
                        htmlFor={`map-${field.key}`}
                      >
                        {field.label}{field.required && ' *'}
                      </label>
                      <select
                        id={`map-${field.key}`}
                        value={mapping[field.key] || ''}
                        onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value })}
                        className="w-full rounded-[8px] px-3 py-2 text-[13px] outline-none"
                        style={inputStyle}
                      >
                        <option value="">— not in this file —</option>
                        {preview.headers.map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                      <p className="text-[10px] mt-1" style={{ color: t.faint }}>{field.hint}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {Object.values(check.errors).length > 0 && (
              <ul className="text-[12px] mb-4 list-disc pl-5" style={{ color: t.err }}>
                {Object.entries(check.errors).map(([key, message]) => <li key={key}>{message}</li>)}
              </ul>
            )}

            <h3 className="text-[11px] font-semibold tracking-[0.10em] uppercase mb-2" style={{ color: t.muted }}>
              First {preview.previewRows.length} rows
            </h3>
            <div
              className="rounded-[10px] border overflow-x-auto mb-5"
              style={{ borderColor: t.tableBorder }}
            >
              <table className="text-[11px] w-full">
                <thead>
                  <tr>
                    {preview.headers.map((h) => (
                      <th
                        key={h}
                        className="text-left font-semibold px-2.5 py-2 whitespace-nowrap"
                        style={{ color: t.muted, borderBottom: `1px solid ${t.tableBorder}` }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.previewRows.map((row, i) => (
                    <tr key={i}>
                      {preview.headers.map((h) => (
                        <td
                          key={h}
                          className="px-2.5 py-1.5 whitespace-nowrap"
                          style={{ color: t.text, borderTop: `1px solid ${t.rowBorder}` }}
                        >
                          {row[h] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={confirm}
                disabled={busy || !check.valid || blockedByDuplicate}
                data-testid="cf-spoton-confirm"
                className="text-[12px] font-semibold tracking-[0.10em] uppercase rounded-[10px] px-4 py-2 disabled:opacity-50"
                style={{ background: t.btnBg, color: t.btnText }}
              >
                {busy
                  ? 'Importing…'
                  : aggregation === AGGREGATION.daily
                    ? `Import ${preview.rowCount.toLocaleString('en-US')} line items`
                    : `Import ${preview.rowCount.toLocaleString('en-US')} rows`}
              </button>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="text-[12px] font-semibold tracking-[0.10em] uppercase rounded-[10px] px-4 py-2 border disabled:opacity-50"
                style={{ borderColor: t.ghostBorder, color: t.ghostText }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
