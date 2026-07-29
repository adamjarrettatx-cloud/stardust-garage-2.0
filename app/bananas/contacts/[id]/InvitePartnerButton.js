'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Sits under the contact form's saved email field. Sending the invite creates a
// login for this contact, so it is admin-only (the route re-checks) and is
// replaced by a status line the moment a partner_profiles row exists — one
// partner account per contact, and re-sending is not a thing we need yet.
export default function InvitePartnerButton({ contactId, email, partnerProfile }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const handleInvite = async () => {
    setError('');
    setSending(true);

    const res = await fetch('/api/admin/invite-partner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId }),
    });
    const data = await res.json().catch(() => null);

    setSending(false);

    if (!res.ok) {
      setError(data?.error || 'Could not send the invite.');
      return;
    }

    setResult(data);
    router.refresh();
  };

  if (partnerProfile) {
    return (
      <div className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
        <span
          className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full mr-3"
          style={
            partnerProfile.is_active
              ? {
                  background: 'var(--auth-success-bg)',
                  color: 'var(--auth-success)',
                  border: '1px solid var(--auth-success-border)',
                }
              : {
                  background: 'var(--auth-warn-bg)',
                  color: 'var(--auth-warn)',
                  border: '1px solid var(--auth-warn-border)',
                }
          }
        >
          {partnerProfile.is_active ? 'PARTNER PROFILE ACTIVE' : 'INVITED — PENDING ACTIVATION'}
        </span>
        {partnerProfile.is_active
          ? `Activated ${formatDateTime(partnerProfile.activated_at)}`
          : `Invited ${formatDateTime(partnerProfile.invited_at)}`}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleInvite}
        disabled={sending || !email}
        className="px-5 py-2.5 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors hover:bg-white/5 disabled:opacity-40"
        style={{ borderColor: 'var(--auth-card-border-strong)', color: 'var(--auth-text)' }}
      >
        {sending ? 'SENDING INVITE...' : 'INVITE TO VERIFY AND CREATE THEIR PROFILE'}
      </button>

      <p className="text-[12px] mt-3" style={{ color: 'var(--auth-muted)' }}>
        {email
          ? `Emails ${email} a one-time link to verify their address, add a photo and get a guest list login. They get no admin, team or member access.`
          : 'Save an email address on this contact first — the invite is sent to the email on file.'}
      </p>

      {error && (
        <p className="text-[13px] mt-3" style={{ color: 'var(--auth-danger)' }}>
          {error}
        </p>
      )}

      {result && (
        <p className="text-[13px] mt-3" style={{ color: 'var(--auth-muted-strong)' }}>
          {result.emailSent
            ? 'Invite sent.'
            : 'Partner profile created, but the invite email failed to send. Send them this link directly:'}
          {result.activationUrl && (
            <span className="block mt-2 break-all text-[12px]" style={{ color: 'var(--auth-text)' }}>
              {result.activationUrl}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
