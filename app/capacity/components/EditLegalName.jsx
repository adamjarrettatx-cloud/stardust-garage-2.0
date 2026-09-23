'use client';

import { useEffect, useRef, useState } from 'react';
import LegalNameInput from '@/app/components/LegalNameInput';
import { validateLegalName } from '@/lib/legal-name';

export default function EditLegalName({ subject, fullName, onSaved, onEditing, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(fullName || '');
  const [expectedName, setExpectedName] = useState(fullName || '');
  const [reason, setReason] = useState('');
  const [idChecked, setIdChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  function close() { setOpen(false); onEditing?.(false); setError(''); }
  async function save() {
    if (busy) return;
    const checked = validateLegalName(name);
    if (!checked.valid) { setError(checked.error); return; }
    if (!idChecked || !reason.trim()) { setError('Check their ID and enter a correction reason.'); return; }
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/capacity/legal-name', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, expectedName, fullName: checked.fullName, reason, idChecked }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not save name.');
      if (mounted.current) onSaved?.(body.fullName);
      window.dispatchEvent(new Event('sdg:access-changed'));
      window.dispatchEvent(new Event('sdg:legal-name-changed'));
      if (mounted.current) close();
    } catch (err) { setError(err.message || 'Connection failed. Refresh before retrying.'); }
    finally { setBusy(false); }
  }
  if (!subject) return null;
  if (!open) return <button type="button" disabled={disabled}
    onClick={() => { setName(fullName || ''); setExpectedName(fullName || ''); setReason(''); setIdChecked(false); setOpen(true); onEditing?.(true); }}
    className="text-[13px] font-semibold underline py-3 disabled:opacity-50">Edit legal name</button>;
  return (
    <div className="rounded-xl border p-3 my-3 space-y-3" style={{ borderColor: 'var(--auth-card-border, #444)' }}>
      <LegalNameInput value={name} onChange={e => setName(e.target.value)} disabled={busy} />
      <label className="block text-[13px]">Correction reason
        <input className="block w-full rounded-lg p-3 mt-1 border" maxLength={500}
          style={{ background: 'var(--auth-input-bg, #141414)', color: 'var(--auth-text, #f5f5f5)' }}
          value={reason} onChange={e => setReason(e.target.value)} disabled={busy} />
      </label>
      <label className="flex items-center gap-2 text-[13px] py-2">
        <input type="checkbox" checked={idChecked} onChange={e => setIdChecked(e.target.checked)} disabled={busy} />
        I checked this name against the guest&apos;s ID.
      </label>
      <p className="text-[12px]">This updates linked profiles and records your correction. It does not check the guest in or remove access restrictions.</p>
      {error && <p role="alert" className="text-[13px] text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy || !idChecked || !reason.trim()}
          className="rounded-lg bg-white text-black px-4 py-3 text-[13px] font-bold disabled:opacity-40">
          {busy ? 'Saving…' : 'Save legal name'}
        </button>
        <button type="button" onClick={close} disabled={busy} className="px-4 py-3 text-[13px] underline">Cancel</button>
      </div>
    </div>
  );
}
