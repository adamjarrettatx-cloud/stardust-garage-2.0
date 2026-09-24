'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import s from '@/components/w9/w9.module.css';

export default function TaxProfileSection({ contactId, displayName, onChange }) {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState('');
  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/contacts/${contactId}/tax-profile`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load W-9 status.');
    setData(result);
    onChange?.({ w9_on_file: result.status === 'approved', status: result.status });
  }, [contactId, onChange]);
  useEffect(() => { load().catch(e => setError(e.message)); }, [load]);
  async function review(submission, decision) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/admin/w9/${submission.id}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, confirmed, reason }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save review.');
      setOpened(null); setConfirmed(false); setReason('');
      await load(); router.refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  const labels = { missing: 'Not submitted', pending: 'Awaiting review', denied: 'Needs a new W-9', approved: 'Approved' };
  const historyLabels = { pending: 'Pending review', denied: 'Denied', approved: 'Approved · current' };
  return <section className={s.panel} aria-label="Artist W-9 review">
    <div className={s.heading}><h2>W-9 · {displayName}</h2><span className={s.badge}>{data ? (!data.canReview && data.status !== 'approved' ? 'Not approved' : labels[data.status]) : 'Loading'}</span></div>
    {error && <p role="alert" className={s.error}>{error}</p>}
    {data && !data.enabled && <p className={s.notice}>W-9 onboarding is not enabled yet.</p>}
    <p className={s.note}>An approved W-9 is required before this artist can be booked or request pay. Payment approval is a separate step.</p>
    {data && !data.canReview && <p className={s.notice}>Tax documents and review actions are restricted to Adam, Jeyu, and Naish.</p>}
    {data?.canReview && data.submissions.length === 0 && <p className={s.notice}>No signed submission yet. The artist completes their profile, then selects “Fill out w9”. A manually uploaded file does not count as approval.</p>}
    {data?.canReview && data.submissions.map(submission => {
      const url = `/api/admin/documents/${submission.document_id}/download`;
      return <article key={submission.id} className={s.history}>
        <div className={s.heading}><h3>{historyLabels[submission.status]}</h3><time>{new Date(submission.created_at).toLocaleString()}</time></div>
        {submission.rejection_reason && <p className={s.notice}>Reviewer comment: {submission.rejection_reason}</p>}
        <div className={s.actions}>
          <button type="button" className={s.button} onClick={() => { setOpened(opened === submission.id ? null : submission.id); setConfirmed(false); setReason(''); }}>{opened === submission.id ? 'Close document' : 'Review W-9'}</button>
          <a className={s.button} href={url} target="_blank" rel="noopener noreferrer">Download signed W-9</a>
        </div>
        {opened === submission.id && <>
          <iframe className={s.document} src={`${url}?inline=1`} title="Signed artist W-9" referrerPolicy="no-referrer" />
          <p className={s.note}>If the preview is unavailable, download the signed W-9 to review it. Review the name, classification, address, TIN and signature; this is not IRS TIN matching.</p>
          {submission.status === 'pending' && data.enabled && <div>
            <label className={s.check}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I have reviewed this signed W-9.</label>
            <label className={s.field}>Comment required for denial<textarea value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} placeholder="Explain what must be corrected. Do not include a tax ID." /></label>
            <div className={s.actions}>
              <button type="button" className={s.primary} disabled={busy || !confirmed} onClick={() => review(submission, 'approved')}>{busy ? 'Saving…' : 'Approve W-9'}</button>
              <button type="button" className={s.button} disabled={busy || !confirmed || !reason.trim()} onClick={() => review(submission, 'denied')}>Deny and request a new W-9</button>
            </div>
          </div>}
        </>}
        {submission.reviewed_at && <p className={s.note}>Reviewed {new Date(submission.reviewed_at).toLocaleString()}. This signed submission cannot be changed or deleted.</p>}
      </article>;
    })}
    <div className={s.actions}><button type="button" className={s.button} disabled={busy} onClick={() => { setError(''); load().catch(e => setError(e.message)); }}>Refresh status</button></div>
  </section>;
}
