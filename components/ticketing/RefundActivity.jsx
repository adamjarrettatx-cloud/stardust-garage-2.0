'use client';
import { useEffect, useState } from 'react';
import { refundApi, refundMoney, refundState } from './RefundDialog';
import styles from '@/app/bananas/events/[id]/attendees/roster.module.css';

export default function RefundActivity({ eventId, refresh, onChange }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/tickets/refunds${eventId ? `?event_id=${eventId}` : ''}`, { cache: 'no-store', signal: controller.signal })
      .then(async (res) => { const data = await res.json(); if (!res.ok) throw new Error(data.error); return data; })
      .then((data) => { setRows(data.refunds || []); setError(''); })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [eventId, refresh]);
  async function check(row) {
    setBusy(row.id); setError('');
    try {
      const { result } = await refundApi({ action: row.can_resume && ['processing', 'pending'].includes(row.status) ? 'execute' : 'check', request_id: row.id });
      setRows((items) => items.map((item) => item.id === row.id ? { ...item, ...result } : item));
      onChange();
    } catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }
  return (
    <details className={styles.activity}>
      <summary>Recent refund activity {rows.length ? `(${rows.length})` : ''}</summary>
      <p className={styles.explanation}>Latest 100 requests. Check pending or interrupted requests here after closing the refund window. A retry uses the original request, not a new refund.</p>
      {error && <p className={styles.refundError} role="alert">{error}</p>}
      {!rows.length && !error && <p className={styles.explanation}>No refund requests yet.</p>}
      {rows.map((row) => <div key={row.id} className={styles.reviewRow}>
        <div><strong>{row.buyer_name || row.buyer_email}</strong><span className={styles.secondary}>{row.event_title} · {row.buyer_email}</span>
          <span className={styles.secondary}>{new Date(row.created_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })} · {row.note}</span>
        </div>
        <div><strong>{refundMoney(row.amount_cents, row.currency)}</strong><span className={styles.secondary}>{refundState(row)}</span></div>
        <button className={styles.button} disabled={!!busy} onClick={() => check(row)}>{busy === row.id ? 'Checking…' : 'Check status'}</button>
        {row.error && <p className={styles.refundError}>{row.error}</p>}
      </div>)}
    </details>
  );
}
