'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatMoney } from '@/lib/pay-request-helpers';
import { PAYOUT_LABELS, payoutBlockReason } from '@/lib/artist-payout-helpers';

export default function MercuryPayoutRow({ req, enabled, environment, busy, onQueue, onRefresh }) {
  const [confirming, setConfirming] = useState(false);
  const payout = req.payout;
  const recipientId = payout?.mercury_recipient_id || req.mercury_recipient_id;
  const amount = payout?.amount_cents ?? req.amount_cents;
  const blocked = payoutBlockReason(req, enabled);
  const hasRequest = Boolean(payout?.mercury_request_id);
  const needsReconciliation = ['rejected', 'cancelled'].includes(payout?.status);
  const buttonStyle = { background: 'var(--auth-accent)', color: 'var(--auth-accent-text)' };

  return (
    <div className="rounded-[10px] border p-4" style={{ background: 'var(--auth-card-bg-alt)', borderColor: 'var(--auth-card-border)' }}>
      <div className="flex flex-wrap justify-between items-start gap-3">
        <div className="min-w-0">
          <Link href={`/bananas/contacts/${req.contact_id}`} className="text-[14px] font-bold hover:underline" style={{ color: 'var(--auth-text-strong)' }}>
            {req.contact?.display_name || 'Unknown contact'}
          </Link>
          <p className="text-[13px] mt-1" style={{ color: 'var(--auth-muted)' }}>{req.event?.title || 'Unknown event'}</p>
          <p className="text-[16px] font-bold mt-1">{formatMoney(amount)}</p>
        </div>
        <span className="text-[12px] font-semibold" style={{ color: 'var(--auth-muted)' }}>
          {payout ? PAYOUT_LABELS[payout.status] || 'Reconciliation required' : 'Approved in SDG - not queued'}
        </span>
      </div>
      {recipientId && <p className="text-[12px] mt-3 break-all" style={{ color: 'var(--auth-muted)' }}>Mercury recipient: {recipientId}</p>}
      {hasRequest && <p className="text-[12px] mt-1 break-all" style={{ color: 'var(--auth-muted)' }}>Mercury request: {payout.mercury_request_id}</p>}
      {blocked && <p className="text-[13px] mt-3" style={{ color: 'var(--auth-warn)' }}>{blocked}</p>}
      {!recipientId && <Link href={`/bananas/contacts/${req.contact_id}`} className="inline-block text-[13px] underline mt-2">Set up Mercury link</Link>}
      {payout?.status === 'unknown' && (
        <p className="text-[13px] mt-3" style={{ color: 'var(--auth-warn)' }}>
          Check Mercury first. Retrying reuses the original recipient, amount, and duplicate-protection key.
          Do not create a separate manual payment while this submission is unresolved.
        </p>
      )}
      {payout?.last_error_code && hasRequest && (
        <p className="text-[13px] mt-3" style={{ color: 'var(--auth-warn)' }}>The last status check failed. The status above is the last confirmed result.</p>
      )}
      {needsReconciliation && <p className="text-[13px] mt-3" style={{ color: 'var(--auth-warn)' }}>Reconcile this request in Mercury. SDG will not automatically create a replacement payout.</p>}
      {confirming && !hasRequest ? (
        <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--auth-card-border)' }}>
          <p className="text-[13px]">
            Queue {formatMoney(amount)} by ACH for {req.contact?.display_name} to recipient <span className="break-all">{recipientId}</span> in Mercury
            {environment === 'sandbox' ? ' Sandbox' : ''}? This requires approval inside Mercury and does not mark the artist paid.
          </p>
          <div className="flex flex-wrap gap-3 mt-3">
            <button type="button" disabled={busy || Boolean(blocked)} className="px-5 py-2.5 rounded-full text-[12px] font-semibold disabled:opacity-40"
              style={buttonStyle}
              onClick={async () => { await onQueue(req.id, recipientId, amount); setConfirming(false); }}>
              {busy ? 'QUEUEING...' : 'CONFIRM QUEUE'}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="px-4 py-2.5 text-[12px] font-semibold">CANCEL</button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          {hasRequest ? (
            <button type="button" disabled={busy || !enabled} onClick={() => onRefresh(req.id)}
              className="px-5 py-2.5 rounded-full border text-[12px] font-semibold disabled:opacity-40" style={{ borderColor: 'var(--auth-card-border)' }}>
              {busy ? 'CHECKING...' : 'REFRESH MERCURY STATUS'}
            </button>
          ) : (
            <button type="button" disabled={busy || Boolean(blocked)} onClick={() => setConfirming(true)}
              className="px-5 py-2.5 rounded-full text-[12px] font-semibold disabled:opacity-40" style={buttonStyle}>
              {payout ? 'RETRY SAME REQUEST' : 'QUEUE IN MERCURY'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
