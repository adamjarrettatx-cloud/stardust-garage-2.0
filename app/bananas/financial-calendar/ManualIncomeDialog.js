'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import { MANUAL_CATEGORIES, DEFAULT_MANUAL_CATEGORY, parseAmountToCents } from '@/lib/manual-income';

// Owner-only modal to create or edit a manual income entry. Talks to the
// owner-gated /api/admin/manual-income route (POST to create, PATCH to edit).
// `editing` is a manual calendar entry (isManual) or null for create.
export default function ManualIncomeDialog({ open, editing, defaultDate, onClose }) {
  const router = useRouter();
  const firstFieldRef = useRef(null);

  const [entryDate, setEntryDate] = useState('');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(DEFAULT_MANUAL_CATEGORY);
  const [customerName, setCustomerName] = useState('');
  const [eventName, setEventName] = useState('');
  const [notes, setNotes] = useState('');

  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);

  const isEdit = Boolean(editing);

  // Seed the form whenever it opens (edit → existing values; create → date hint).
  useEffect(() => {
    if (!open) return;
    setFieldErrors({});
    setFormError(null);
    setBusy(false);
    if (editing) {
      setEntryDate(editing.eventDate || '');
      setTitle(editing.title || '');
      setAmount(editing.grossCents != null ? (editing.grossCents / 100).toFixed(2) : '');
      setCategory(editing.category || DEFAULT_MANUAL_CATEGORY);
      setCustomerName(editing.customerName || '');
      setEventName(editing.eventName || '');
      setNotes(editing.notes || '');
    } else {
      setEntryDate(defaultDate || '');
      setTitle('');
      setAmount('');
      setCategory(DEFAULT_MANUAL_CATEGORY);
      setCustomerName('');
      setEventName('');
      setNotes('');
    }
  }, [open, editing, defaultDate]);

  // Focus the first field and support Escape-to-close for accessibility.
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => firstFieldRef.current?.focus(), 0);
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [open, busy, onClose]);

  if (!open) return null;

  function validateClient() {
    const errs = {};
    if (!entryDate) errs.entryDate = 'A date is required.';
    if (!title.trim()) errs.title = 'A title is required.';
    const amt = parseAmountToCents(amount);
    if (amt.error) errs.amount = amt.error;
    else if (amt.cents <= 0) errs.amount = 'Amount must be greater than zero.';
    return errs;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setFormError(null);
    const errs = validateClient();
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      const payload = {
        entryDate,
        title: title.trim(),
        amount,
        category,
        customerName: customerName.trim() || null,
        eventName: eventName.trim() || null,
        notes: notes.trim() || null,
      };
      if (isEdit) payload.id = editing.manualId;

      await adminFetch('/api/admin/manual-income', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      onClose();
      router.refresh();
    } catch (err) {
      setFormError(err?.message || 'Could not save the entry.');
    } finally {
      setBusy(false);
    }
  }

  const label = { fontFamily: "'Plus Jakarta Sans', sans-serif" };
  const inputCls = 'w-full rounded-[8px] px-3 py-2 text-[14px] outline-none';
  const inputStyle = { background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.12)', color: '#f5f5f5' };
  const fieldErr = (k) => fieldErrors[k] && (
    <p className="text-[11px] mt-1" style={{ color: '#f87171' }}>{fieldErrors[k]}</p>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={() => { if (!busy) onClose(); }}
      data-testid="fc-manual-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit manual income' : 'Add manual income'}
        className="w-full sm:max-w-[460px] rounded-t-[16px] sm:rounded-[16px] border p-5 max-h-[92vh] overflow-y-auto"
        style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.1)' }}
        onClick={(e) => e.stopPropagation()}
        data-testid="fc-manual-dialog"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[18px] font-bold" style={label}>
            {isEdit ? 'Edit income' : 'Add income'}
          </h3>
          <button type="button" onClick={() => !busy && onClose()} aria-label="Close" className="text-[20px] leading-none transition-opacity hover:opacity-50" style={{ color: '#8a8a8a' }}>×</button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3" noValidate>
          <div>
            <label htmlFor="mi-date" className="block text-[11px] uppercase tracking-[0.1em] mb-1" style={{ color: '#8a8a8a' }}>Date *</label>
            <input
              id="mi-date" ref={firstFieldRef} type="date" required
              value={entryDate} onChange={(e) => setEntryDate(e.target.value)}
              className={inputCls} style={inputStyle} data-testid="fc-manual-date"
              aria-invalid={Boolean(fieldErrors.entryDate)}
            />
            {fieldErr('entryDate')}
          </div>

          <div>
            <label htmlFor="mi-title" className="block text-[11px] uppercase tracking-[0.1em] mb-1" style={{ color: '#8a8a8a' }}>Title / name *</label>
            <input
              id="mi-title" type="text" required maxLength={200} placeholder="SolarPunk venue rental"
              value={title} onChange={(e) => setTitle(e.target.value)}
              className={inputCls} style={inputStyle} data-testid="fc-manual-title"
              aria-invalid={Boolean(fieldErrors.title)}
            />
            {fieldErr('title')}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="mi-amount" className="block text-[11px] uppercase tracking-[0.1em] mb-1" style={{ color: '#8a8a8a' }}>Amount (USD) *</label>
              <input
                id="mi-amount" type="text" inputMode="decimal" required placeholder="2,800.00"
                value={amount} onChange={(e) => setAmount(e.target.value)}
                className={inputCls} style={inputStyle} data-testid="fc-manual-amount"
                aria-invalid={Boolean(fieldErrors.amount)}
              />
              {fieldErr('amount')}
            </div>
            <div>
              <label htmlFor="mi-category" className="block text-[11px] uppercase tracking-[0.1em] mb-1" style={{ color: '#8a8a8a' }}>Category *</label>
              <select
                id="mi-category" value={category} onChange={(e) => setCategory(e.target.value)}
                className={inputCls} style={inputStyle} data-testid="fc-manual-category"
              >
                {MANUAL_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="mi-customer" className="block text-[11px] uppercase tracking-[0.1em] mb-1" style={{ color: '#8a8a8a' }}>Customer</label>
              <input id="mi-customer" type="text" maxLength={200} value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={inputCls} style={inputStyle} data-testid="fc-manual-customer" />
            </div>
            <div>
              <label htmlFor="mi-event" className="block text-[11px] uppercase tracking-[0.1em] mb-1" style={{ color: '#8a8a8a' }}>Event name</label>
              <input id="mi-event" type="text" maxLength={200} value={eventName} onChange={(e) => setEventName(e.target.value)} className={inputCls} style={inputStyle} data-testid="fc-manual-event" />
            </div>
          </div>

          <div>
            <label htmlFor="mi-notes" className="block text-[11px] uppercase tracking-[0.1em] mb-1" style={{ color: '#8a8a8a' }}>Notes</label>
            <textarea id="mi-notes" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} style={inputStyle} data-testid="fc-manual-notes" />
          </div>

          {formError && (
            <p className="text-[12px] rounded-[8px] px-3 py-2" style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171' }} data-testid="fc-manual-error" role="alert">
              {formError}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button type="button" onClick={() => !busy && onClose()} className="text-[12px] font-semibold tracking-[0.08em] uppercase px-4 py-2 rounded-[10px] border transition-colors hover:bg-white/10" style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#aaa' }}>Cancel</button>
            <button type="submit" disabled={busy} className="text-[12px] font-semibold tracking-[0.08em] uppercase px-5 py-2 rounded-[10px] transition-colors disabled:opacity-50" style={{ background: '#4ade80', color: '#0a0a0a' }} data-testid="fc-manual-submit">
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add income'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
