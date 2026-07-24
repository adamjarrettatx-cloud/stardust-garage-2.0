'use client';

import { useState } from 'react';
import { departmentLabel, statusLabel } from '@/lib/progress';

async function apiJson(url, options) {
  const res = await fetch(url, options);
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  if (res.status === 401 && json?.reason === 'mfa_required' && typeof window !== 'undefined') {
    window.location.href = '/bananas/security?mfa=required';
    throw new Error('MFA required');
  }
  if (!res.ok) throw new Error(json?.error || 'Request failed');
  return json;
}

const SAMPLE = 'Department/Area,Deliverable,Status\nMarketing,Summer campaign flyer,In progress\nLegal,Vendor contract review,Blocked';

// Admin/Owner CSV importer. Two-step: preview (dryRun) then confirm. The
// free-form Status column is mapped to our enum and the original note is kept
// in the task description — nothing is silently promoted to a real status.
export default function ImportModal({ onClose, onImported }) {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  async function runPreview() {
    setBusy(true); setError(''); setDone(null);
    try {
      const json = await apiJson('/api/progress/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, dryRun: true }),
      });
      setPreview(json);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function confirmImport() {
    setBusy(true); setError('');
    try {
      const json = await apiJson('/api/progress/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, dryRun: false }),
      });
      setDone(json);
      onImported?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/70" style={{ border: 'none', cursor: 'pointer' }} />
      <div className="relative w-full max-w-[640px] max-h-[90vh] overflow-y-auto rounded-[16px] p-6"
        style={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)' }}>
        <h2 className="text-[22px] font-extrabold mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Import from spreadsheet</h2>
        <p className="text-[13px] mb-4" style={{ color: '#8a8a8a' }}>
          Paste CSV with <strong>Department/Area</strong>, <strong>Deliverable</strong> and optional <strong>Status</strong> columns.
          Status text is mapped to a workflow status; the original note is saved in the task details.
        </p>

        {error && <div className="rounded-lg px-4 py-3 mb-4 text-[13px]" style={{ background: 'rgba(239,68,68,0.12)', color: '#fca5a5' }} role="alert">{error}</div>}

        {done ? (
          <div className="rounded-lg px-4 py-4 text-[14px]" style={{ background: 'rgba(16,185,129,0.12)', color: '#6ee7b7' }}>
            Imported {done.imported} task{done.imported === 1 ? '' : 's'}. {done.skipped > 0 && `${done.skipped} row(s) skipped.`}
            <div className="mt-4">
              <button onClick={onClose} className="px-5 py-2.5 rounded-full text-[12px] font-semibold" style={{ minHeight: '44px', background: '#ffb84d', color: '#0a0a0a', border: 'none', cursor: 'pointer' }}>DONE</button>
            </div>
          </div>
        ) : (
          <>
            <textarea value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }}
              rows={7} placeholder={SAMPLE}
              className="w-full rounded-lg px-3 py-2.5 text-[13px] font-mono resize-y"
              style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)', color: '#f5f5f5' }} />

            {preview && (
              <div className="mt-4">
                <div className="text-[12px] mb-2" style={{ color: '#8a8a8a' }}>
                  {preview.willImport} row(s) ready · {preview.errors.length} skipped
                </div>
                {preview.rows.length > 0 && (
                  <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr style={{ background: '#161616', color: '#8a8a8a' }}>
                          <th className="text-left px-3 py-2 font-semibold">Dept</th>
                          <th className="text-left px-3 py-2 font-semibold">Deliverable</th>
                          <th className="text-left px-3 py-2 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.slice(0, 50).map((r) => (
                          <tr key={r.line} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                            <td className="px-3 py-2" style={{ color: '#c0c0c0' }}>{departmentLabel(r.department)}</td>
                            <td className="px-3 py-2" style={{ color: '#e5e5e5' }}>{r.title}</td>
                            <td className="px-3 py-2" style={{ color: '#c0c0c0' }}>{statusLabel(r.status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {preview.errors.length > 0 && (
                  <ul className="mt-3 text-[12px] space-y-1" style={{ color: '#fca5a5' }}>
                    {preview.errors.slice(0, 20).map((er, i) => <li key={i}>Line {er.line}: {er.message}</li>)}
                  </ul>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 mt-6">
              <button onClick={onClose} className="px-5 py-3 rounded-full text-[12px] font-semibold tracking-[0.1em] hover:bg-white/5"
                style={{ minHeight: '44px', border: '1px solid rgba(255,255,255,0.15)', color: '#aaa', cursor: 'pointer' }}>CANCEL</button>
              {!preview ? (
                <button onClick={runPreview} disabled={busy || !csv.trim()}
                  className="px-6 py-3 rounded-full text-[12px] font-semibold tracking-[0.1em] disabled:opacity-40"
                  style={{ minHeight: '44px', background: 'rgba(255,255,255,0.1)', color: '#f5f5f5', border: 'none', cursor: 'pointer' }}>
                  {busy ? 'CHECKING…' : 'PREVIEW'}
                </button>
              ) : (
                <button onClick={confirmImport} disabled={busy || preview.willImport === 0}
                  className="px-6 py-3 rounded-full text-[12px] font-semibold tracking-[0.1em] disabled:opacity-40"
                  style={{ minHeight: '44px', background: '#ffb84d', color: '#0a0a0a', border: 'none', cursor: 'pointer' }}>
                  {busy ? 'IMPORTING…' : `IMPORT ${preview.willImport}`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
