'use client';

import { useEffect, useRef, useState } from 'react';
import styles from '@/app/bananas/events/[id]/attendees/roster.module.css';

export const refundMoney = (cents, currency = 'usd') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(cents || 0) / 100);
export const refundState = (row) => ({
  succeeded: 'Refunded',
  failed: 'Not refunded',
  pending: row.stripe_status === 'requires_action' ? 'Customer action required' : 'Pending in Stripe',
  processing: 'Needs status check',
  needs_check: 'Needs status check',
})[row.status] || row.status;

export async function refundApi(body) {
  const response = await fetch('/api/admin/tickets/refunds', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not complete this request');
  return data;
}

export default function RefundDialog({ orders, onClose, onDone }) {
  const dialog = useRef(null);
  const running = useRef(false);
  const [mode, setMode] = useState('full');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [review, setReview] = useState(null);
  const [results, setResults] = useState({});
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const totals = (review?.requests || []).reduce((out, row) => {
    out[row.currency] = (out[row.currency] || 0) + Number(row.amount_cents);
    return out;
  }, {});
  const totalLabel = Object.entries(totals).map(([currency, cents]) => refundMoney(cents, currency)).join(' + ');

  async function prepare() {
    if (running.current) return;
    setError('');
    if (!note.trim()) { setError('Enter a refund reason.'); return; }
    let cents = null;
    if (mode === 'partial') {
      const dollars = amount.trim();
      if (!/^\d+(\.\d{1,2})?$/.test(dollars)) { setError('Enter a dollar amount with up to two decimal places.'); return; }
      const [whole, fraction = ''] = dollars.split('.');
      cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
      if (!Number.isSafeInteger(cents) || cents <= 0) { setError('Enter a positive refund amount.'); return; }
    }
    running.current = true;
    setBusy(true);
    try {
      setReview(await refundApi({ action: 'review', order_ids: orders.map((o) => o.id), amount_cents: cents, note }));
    } catch (err) { setError(err.message); }
    finally { running.current = false; setBusy(false); }
  }

  async function execute(requests = review.requests) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setStarted(true);
    setError('');
    for (const row of requests) {
      setResults((current) => ({ ...current, [row.id]: { status: 'submitting' } }));
      try {
        const data = await refundApi({ action: 'execute', request_id: row.id });
        setResults((current) => ({ ...current, [row.id]: data.result }));
      } catch (err) {
        setResults((current) => ({ ...current, [row.id]: { status: 'needs_check', error: err.message } }));
      }
    }
    running.current = false;
    setBusy(false);
    onDone();
  }

  return (
    <dialog ref={dialog} className={styles.refundDialog} aria-labelledby="refund-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <div className={styles.dialogHeader}>
        <div><p className={styles.eyebrow}>TICKET REFUNDS</p><h2 id="refund-title">{started ? 'Refund results' : review ? 'Confirm refunds' : 'Prepare refund'}</h2></div>
        <button className={styles.button} disabled={busy} onClick={onClose} aria-label="Close refund dialog">Close</button>
      </div>
      {!review ? (
        <>
          <p>{orders.length} {orders.length === 1 ? 'order selected' : 'orders selected'}. No money moves until you review and confirm.</p>
          {orders.length === 1 && <p><strong>{orders[0].buyer_name || 'Name not provided'}</strong><br />{orders[0].buyer_email}</p>}
          <fieldset className={styles.refundOptions}>
            <legend>Refund amount</legend>
            <label><input type="radio" name="refund-mode" checked={mode === 'full'} onChange={() => setMode('full')} /> Full remaining balance{orders.length === 1 ? ` (${refundMoney(orders[0].total_cents - (orders[0].refunded_cents || 0), orders[0].currency)})` : ' for each order'}</label>
            {orders.length === 1 && orders[0].currency === 'usd' && (
              <label><input type="radio" name="refund-mode" checked={mode === 'partial'} onChange={() => setMode('partial')} /> Partial refund (USD)</label>
            )}
          </fieldset>
          {mode === 'partial' && <label className={styles.dialogField}>Amount in dollars
            <input autoComplete="off" inputMode="decimal" placeholder="25.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>}
          <label className={styles.dialogField}>Reason for refund
            <textarea maxLength={500} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: customer request or event cancellation" />
          </label>
          <p className={styles.explanation}>Full refunds include the remaining order total, including booking fees and tax. Partial refunds are dollar amounts, not individual ticket cancellations.</p>
        </>
      ) : (
        <>
          <p className={styles.notice}>{started ? 'Results are tracked per order. A pending or unconfirmed refund is not reported as completed.'
            : `Refund ${totalLabel || '0'} across ${review.requests.length} ${review.requests.length === 1 ? 'order' : 'orders'} to the original payment ${review.requests.length === 1 ? 'method' : 'methods'}. These are real refunds, not account credits.`}</p>
          <p><strong>Reason:</strong> {note}</p>
          <div className={styles.reviewList}>
            {review.requests.map((row) => <div key={row.id} className={styles.reviewRow}>
              <div><strong>{row.buyer_name || row.buyer_email}</strong><span className={styles.secondary}>{row.buyer_email}</span>
                <span className={styles.secondary}>{row.event_title} · Order {row.order_id.slice(0, 8)}</span>
                <span className={styles.secondary}>{row.amount_cents === row.remaining_cents ? 'Full remaining balance' : 'Partial refund; tickets remain valid'}</span>
              </div>
              <div className={styles.reviewAmount}><strong>{refundMoney(row.amount_cents, row.currency)}</strong>
                {results[row.id] && <span role="status" className={styles.secondary}>{results[row.id].status === 'submitting' ? 'Submitting…' : refundState(results[row.id])}</span>}
              </div>
              {results[row.id]?.error && <p className={styles.refundError}>{results[row.id].error}</p>}
              {['needs_check', 'pending', 'processing'].includes(results[row.id]?.status) && (
                <button className={styles.button} disabled={busy} onClick={() => execute([row])}>Check / retry this request</button>
              )}
            </div>)}
            {review.skipped.map((row) => <div key={row.order_id} className={styles.reviewRow}>
              <div><strong>{row.buyer_name || row.buyer_email}</strong><span className={styles.secondary}>Skipped: {row.reason}</span></div>
            </div>)}
          </div>
          <p className={styles.explanation}>Unused tickets are canceled after a full refund succeeds. Partial and pending refunds do not cancel tickets. Already-scanned tickets keep their check-in history. A failed refund does not automatically restore canceled tickets.</p>
        </>
      )}
      {error && <p role="alert" className={styles.refundError}>{error}</p>}
      <footer className={styles.dialogFooter}>
        {busy ? <span role="status">{started ? 'Processing refunds. Keep this window open.' : 'Preparing review…'}</span>
          : !review ? <button className={styles.primaryButton} onClick={prepare}>Review refund{orders.length === 1 ? '' : 's'}</button>
          : !started ? <>
            <button className={styles.button} onClick={() => setReview(null)}>Back</button>
            <button className={styles.primaryButton} disabled={!review.requests.length} onClick={() => execute()}>
              Confirm {review.requests.length} refund{review.requests.length === 1 ? '' : 's'} · {totalLabel || '0'}
            </button>
          </> : <button className={styles.button} onClick={onClose}>Done</button>}
      </footer>
    </dialog>
  );
}
