'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from '@/app/bananas/events/[id]/attendees/roster.module.css';

const MAX_QUANTITY = 20;

function newRef() {
  return `comp-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
}

function remainingLabel(product) {
  if (product.capacity == null) return 'Unlimited';
  const left = Math.max(0, product.capacity - (product.sold_count || 0) - (product.reserved_count || 0));
  return `${left} left`;
}

// Issue complimentary tickets for one event. Admin only.
export default function CompDialog({ event, onClose, onDone }) {
  const dialog = useRef(null);
  const submitting = useRef(false);
  const ref = useRef(newRef());
  const [products, setProducts] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => { dialog.current?.showModal(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/tickets/products?event_id=${event.id}`, { cache: 'no-store', signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load ticket types');
        const list = (data.products || []).filter((p) => (p.kind || 'tickets') === 'tickets');
        setProducts(list);
        const first = list.find((p) => p.is_active) || list[0];
        if (first) setProductId(first.id);
      })
      .catch((err) => { if (!controller.signal.aborted) setLoadError(err.message); });
    return () => controller.abort();
  }, [event.id]);

  const selected = useMemo(() => (products || []).find((p) => p.id === productId), [products, productId]);

  async function submit(e) {
    e.preventDefault();
    if (submitting.current) return;
    setError('');
    const qty = Number(quantity);
    if (!productId) { setError('Choose a ticket type.'); return; }
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QUANTITY) { setError(`Quantity must be between 1 and ${MAX_QUANTITY}.`); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a valid recipient email.'); return; }
    if (!note.trim()) { setError('Enter a reason for the comp.'); return; }
    submitting.current = true;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/tickets/comp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: event.id,
          product_id: productId,
          quantity: qty,
          buyer_email: email.trim(),
          buyer_name: name.trim() || null,
          note: note.trim(),
          send_email: sendEmail,
          comp_ref: ref.current,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not issue the comp');
      setResult({ ...data, quantity: qty, to: email.trim(), productName: selected?.name });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function issueAnother() {
    ref.current = newRef();
    setResult(null);
    setQuantity('1');
    setName('');
    setEmail('');
    setNote('');
    setError('');
  }

  return (
    <dialog ref={dialog} className={styles.refundDialog} aria-labelledby="comp-title"
      onCancel={(e) => { if (busy) e.preventDefault(); else onClose(); }}>
      <div className={styles.dialogHeader}>
        <div>
          <p className={styles.eyebrow}>ISSUE COMP</p>
          <h2 id="comp-title">{event.title}</h2>
        </div>
        <button type="button" className={styles.button} disabled={busy} onClick={onClose}>Close</button>
      </div>

      {result ? (
        <div role="status">
          <p>
            {result.deduped
              ? 'This comp was already issued. No additional tickets were created.'
              : `Issued ${result.tickets} comp ticket${result.tickets === 1 ? '' : 's'}${result.productName ? ` (${result.productName})` : ''} to ${result.to}.`}
          </p>
          {result.email?.status === 'sent' && <p className={styles.sentNote}>Tickets emailed to {result.email.to}.</p>}
          {result.email?.status === 'failed' && (
            <p className={styles.failedNote} role="alert">
              The tickets were issued, but the email did not send: {result.email.error}. Use Send to their email on the order row.
            </p>
          )}
          {result.email?.status === 'skipped' && !result.deduped && <p className={styles.muted}>No email was sent. The tickets are on the order in this list.</p>}
          <div className={styles.dialogFooter}>
            <button type="button" className={styles.button} onClick={issueAnother}>Issue another</button>
            <button type="button" className={styles.primaryButton} onClick={onClose}>Done</button>
          </div>
        </div>
      ) : loadError ? (
        <div role="alert"><p>{loadError}</p></div>
      ) : !products ? (
        <p role="status" className={styles.muted}>Loading ticket types…</p>
      ) : !products.length ? (
        <p>This event has no ticket types yet. Add one in the event editor's Ticketing panel first.</p>
      ) : (
        <form onSubmit={submit} noValidate>
          <p className={styles.muted}>Comp tickets are free, count against the ticket type's capacity, and appear in this list as a $0 order.</p>
          <label className={styles.dialogField}>
            Ticket type
            <select value={productId} onChange={(e) => setProductId(e.target.value)} disabled={busy}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {remainingLabel(p)}{p.is_active ? '' : ' · off sale'}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.dialogField}>
            Quantity
            <input type="number" inputMode="numeric" min={1} max={MAX_QUANTITY} value={quantity}
              onChange={(e) => setQuantity(e.target.value)} disabled={busy} />
          </label>
          <label className={styles.dialogField}>
            Recipient name
            <input type="text" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </label>
          <label className={styles.dialogField}>
            Recipient email
            <input type="email" autoComplete="off" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
          </label>
          <label className={styles.dialogField}>
            Reason
            <textarea rows={2} required maxLength={500} placeholder="e.g. Artist guest, promoter, make-good"
              value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </label>
          <label className={styles.checkboxField}>
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} disabled={busy} />
            Email the tickets to the recipient
          </label>
          {error && <p className={styles.refundError} role="alert">{error}</p>}
          <div className={styles.dialogFooter}>
            <button type="button" className={styles.button} disabled={busy} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.primaryButton} disabled={busy}>
              {busy ? 'Issuing…' : `Issue ${Number(quantity) > 1 ? `${quantity} comps` : 'comp'}`}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
