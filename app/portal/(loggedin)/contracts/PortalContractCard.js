'use client';

import { useState } from 'react';
import { formatVenueDateTime } from '@/lib/contract-helpers';

// One agreement, from the counterparty's point of view.
//
// The card is deliberately plain-spoken: a signer wants to know what it is, what
// it's for, whether it still needs them, and whether they can read it. It carries
// no envelope id, no signing link and no file URL — the only file access is the
// authenticated route below, which re-checks ownership server-side.

const STATUS_COPY = {
  sent: { label: 'Waiting on your signature', color: '#fbbf24' },
  partially_signed: { label: 'Partly signed', color: '#a78bfa' },
  signed: { label: 'Fully signed', color: '#4ade80' },
  pending_review: { label: 'In review with us', color: '#8a8a8a' },
  declined: { label: 'Declined', color: '#f87171' },
  void: { label: 'Void', color: '#f87171' },
  expired: { label: 'Expired', color: '#f87171' },
};

export default function PortalContractCard({ contract }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const copy = STATUS_COPY[contract.status] || { label: contract.status, color: '#8a8a8a' };
  const needsYou = ['sent', 'partially_signed'].includes(contract.status);
  // Only a completed agreement is offered as a file. Mid-signature, the copy we
  // hold is not the executed document, and handing it over invites confusion
  // about which version was signed.
  const canView = contract.status === 'signed';

  async function view() {
    setDownloading(true);
    setError('');
    try {
      // Fetch rather than a bare link so a 403/404 surfaces as a message instead
      // of dumping an error page over the portal.
      const res = await fetch(`/api/portal/contracts/${contract.contract_id}/download`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Could not open that document.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      // Give the new tab time to take the blob before revoking it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err.message || 'Could not open that document.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      className="rounded-[16px] border p-5 sm:p-6"
      style={{ background: '#141414', borderColor: needsYou ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.06)' }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[16px] font-semibold leading-[1.35] break-words">{contract.title}</div>
          {contract.event_title && (
            <div className="text-[13px] mt-1" style={{ color: '#8a8a8a' }}>
              For {contract.event_title}
              {contract.event_date ? ` · ${contract.event_date}` : ''}
            </div>
          )}
        </div>
        <span
          className="text-[10px] font-semibold tracking-[0.14em] px-3 py-1.5 rounded-full whitespace-nowrap"
          style={{ color: copy.color, border: `1px solid ${copy.color}55`, background: `${copy.color}1a` }}
        >
          {copy.label.toUpperCase()}
        </span>
      </div>

      <div className="text-[12px] mt-3 flex flex-wrap gap-x-4 gap-y-1" style={{ color: '#6f6f6f' }}>
        {contract.sent_at && <span>Sent {formatVenueDateTime(contract.sent_at)}</span>}
        {contract.expiration_date && <span>Please sign by {formatVenueDateTime(contract.expiration_date)}</span>}
        {contract.completed_at && <span>Completed {formatVenueDateTime(contract.completed_at)}</span>}
      </div>

      {needsYou && (
        <p className="text-[13px] leading-[1.6] mt-4" style={{ color: '#a0a0a0' }}>
          Check your email for the secure signature request
          {contract.signer_email ? ` sent to ${contract.signer_email}` : ''}. Can&rsquo;t find it? Email{' '}
          <a href="mailto:hello@sdgatx.com" className="underline">hello@sdgatx.com</a> and we&rsquo;ll resend it.
        </p>
      )}

      {canView && (
        <div className="mt-4">
          <button
            type="button"
            onClick={view}
            disabled={downloading}
            className="px-5 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.14em]"
            style={{ background: '#ffffff', color: '#0a0a0a', opacity: downloading ? 0.6 : 1 }}
          >
            {downloading ? 'OPENING…' : 'VIEW SIGNED COPY'}
          </button>
        </div>
      )}

      {error && (
        <p className="text-[12px] mt-3" style={{ color: '#f87171' }}>
          {error}
        </p>
      )}
    </div>
  );
}
