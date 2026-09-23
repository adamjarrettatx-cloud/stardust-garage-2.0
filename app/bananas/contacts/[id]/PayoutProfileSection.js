'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { PAYOUT_UUID } from '@/lib/artist-payout-helpers';

export default function PayoutProfileSection({ contactId, displayName }) {
  const [recipientId, setRecipientId] = useState('');
  const [savedId, setSavedId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setLoadFailed(false);
    try {
      const { profile } = await adminFetch(`/api/admin/contacts/${contactId}/payout-profile`);
      setRecipientId(profile?.mercury_recipient_id || '');
      setSavedId(profile?.mercury_recipient_id || '');
    } catch (err) {
      setError(err.message || 'Could not load the Mercury link.');
      setLoadFailed(true);
    } finally { setLoading(false); }
  }, [contactId]);
  useEffect(() => { load(); }, [load]);

  async function save(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!PAYOUT_UUID.test(recipientId.trim()) || !confirmed) {
      setError('Enter a valid Mercury recipient ID and confirm the recipient in Mercury.');
      return;
    }
    setBusy(true);
    try {
      const { profile } = await adminFetch(`/api/admin/contacts/${contactId}/payout-profile`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mercury_recipient_id: recipientId.trim(), confirmed_in_mercury: true }),
      });
      setSavedId(profile.mercury_recipient_id);
      setRecipientId(profile.mercury_recipient_id);
      setConfirmed(false);
      setSuccess('Mercury recipient linked. No banking details were saved.');
    } catch (err) { setError(err.message || 'Could not save the Mercury link.'); }
    finally { setBusy(false); }
  }

  return (
    <section className="rounded-[14px] p-6 border mt-4" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
      <h2 className="text-[14px] font-bold mb-3" style={{ color: 'var(--auth-text-strong)' }}>MERCURY PAYOUT PROFILE</h2>
      <p className="text-[13px] mb-4" style={{ color: 'var(--auth-muted)' }}>
        Set up {displayName} directly in Mercury, then paste only the recipient ID here.
        Do not enter bank account numbers, routing numbers, or banking documents on this site.
      </p>
      {loading ? <p className="text-[13px]" role="status">Loading Mercury link...</p> : (
        <form onSubmit={save}>
          {savedId && <p className="text-[13px] mb-3" style={{ color: 'var(--auth-success)' }}>Recipient linked. Banking details stay in Mercury.</p>}
          <label htmlFor={`mercury-recipient-${contactId}`} className="block text-[13px] font-semibold mb-2">Mercury recipient ID</label>
          <input
            id={`mercury-recipient-${contactId}`} type="text" autoComplete="off" spellCheck={false}
            value={recipientId} maxLength={36} required disabled={busy || loadFailed}
            onChange={(e) => { setRecipientId(e.target.value); setConfirmed(false); setSuccess(''); }}
            placeholder="Recipient UUID, not a bank account number"
            className="w-full rounded-[10px] border px-3 py-3 text-[13px]"
            style={{ background: 'var(--auth-input-bg)', borderColor: 'var(--auth-input-border)', color: 'var(--auth-input-text)' }}
          />
          <label className="flex items-start gap-3 text-[13px] mt-4">
            <input type="checkbox" className="mt-1" checked={confirmed} disabled={busy || loadFailed}
              onChange={(e) => setConfirmed(e.target.checked)} />
            <span>I verified in Mercury that this recipient belongs to {displayName} and is set up for ACH payments.</span>
          </label>
          <button type="submit" disabled={busy || loadFailed || !confirmed || !PAYOUT_UUID.test(recipientId.trim())}
            className="mt-4 px-5 py-2.5 rounded-full text-[12px] font-semibold disabled:opacity-40"
            style={{ background: 'var(--auth-accent)', color: 'var(--auth-accent-text)' }}>
            {busy ? 'SAVING...' : 'SAVE MERCURY LINK'}
          </button>
        </form>
      )}
      {error && <p role="alert" className="text-[13px] mt-3" style={{ color: 'var(--auth-danger)' }}>{error}</p>}
      {loadFailed && <button type="button" onClick={load} className="text-[13px] underline mt-2">Retry loading</button>}
      {success && <p role="status" className="text-[13px] mt-3" style={{ color: 'var(--auth-success)' }}>{success}</p>}
    </section>
  );
}
