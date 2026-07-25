'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { adminFetch } from '@/lib/admin-fetch';
import useSubmissionStatus from '@/app/bananas/components/useSubmissionStatus';
import { canResetSubmissionToNew } from '@/lib/submission-workflow';

export default function ApplicationActions({
  applicationId,
  currentStatus,
  accountCreated,
  hasPhoto,
}) {
  const router = useRouter();
  const { status, working, notice, error, setError, updateStatus } = useSubmissionStatus('applications', applicationId, currentStatus);
  const [approveError, setApproveError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const busy = working || actionBusy;

  // Approving: call the API so we create an auth user + member profile
  // + send welcome email. The API is idempotent — calling it again on
  // an already-approved application is safe.
  const handleApprove = async () => {
    setApproveError('');

    if (!hasPhoto) {
      setApproveError('A profile photo is required before approving this member.');
      return;
    }

    if (!accountCreated) {
      const confirmed = window.confirm(
        'Accept this application and create a member account?\n\n' +
          'A login email with a temporary password will be sent to the applicant.'
      );
      if (!confirmed) return;
    }

    setActionBusy(true);
    try {
      const body = await adminFetch('/api/admin/approve-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId }),
      });

      if (body.alreadyHadAccount) {
        alert('Application accepted. (Member account was already active.)');
      } else if (body.passwordEmailed) {
        alert('Accepted. Welcome email sent to the new member.');
      } else {
        alert(
          "Accepted. The applicant's email was already a Supabase user — they keep their existing password."
        );
      }

      router.refresh();
    } catch (err) {
      alert('Error: ' + (err?.message || 'Unknown'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleDelete = async () => {
    const confirmed = window.confirm('Permanently delete this application?');
    if (!confirmed) return;

    setActionBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from('membership_applications')
      .delete()
      .eq('id', applicationId);

    if (error) {
      setError(error.message);
      setActionBusy(false);
      return;
    }
    router.push('/bananas/applications');
    router.refresh();
  };

  const btnBase =
    'px-5 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.12em] transition-all hover:-translate-y-0.5 disabled:opacity-50';

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {/* ── Accept / create account ───────────────────── */}
        {status !== 'approved' && (
          <button
            onClick={handleApprove}
            disabled={busy}
            className={`${btnBase} auth-theme-solid-button`}
          >
            {accountCreated ? 'ACCEPT' : 'ACCEPT & CREATE ACCOUNT'}
          </button>
        )}
        {status === 'approved' && !accountCreated && (
          <button
            onClick={handleApprove}
            disabled={busy}
            className={`${btnBase} auth-theme-solid-button`}
          >
            CREATE MEMBER ACCOUNT
          </button>
        )}

        {/* ── Mark Reviewed ─────────────────────────────── */}
        {status !== 'reviewed' && status !== 'approved' && status !== 'rejected' && (
          <button
            onClick={() => updateStatus('reviewed')}
            disabled={busy}
            className={btnBase}
            style={{
              background: 'rgba(168,85,247,0.12)',
              color: '#c084fc',
              border: '1px solid rgba(168,85,247,0.3)',
            }}
          >
            MARK AS SEEN
          </button>
        )}

        {canResetSubmissionToNew(status) && (
          <button
            onClick={() => updateStatus('new')}
            disabled={busy}
            className={`${btnBase} border`}
            style={{ borderColor: 'var(--auth-warn-border)', color: 'var(--auth-warn-strong)' }}
          >
            MARK AS NEW
          </button>
        )}

        {/* ── Mark Pending ──────────────────────────────── */}
        {status !== 'pending' && (
          <button
            onClick={() => updateStatus('pending')}
            disabled={busy}
            className={`${btnBase} border auth-theme-border-button`}
            style={{ color: 'var(--auth-muted-strong)' }}
          >
            MARK PENDING
          </button>
        )}

        {/* ── Reject ────────────────────────────────────── */}
        {status !== 'rejected' && (
          <button
            onClick={() => updateStatus('rejected')}
            disabled={busy}
            className={`${btnBase} border hover:bg-red-500/10 hover:border-red-500/40`}
            style={{ borderColor: 'var(--auth-danger-border)', color: 'var(--auth-text)' }}
          >
            REJECT
          </button>
        )}

        {/* ── Delete ────────────────────────────────────── */}
        <button
          onClick={handleDelete}
          disabled={busy}
          className={`ml-auto ${btnBase} border hover:bg-red-500/10 hover:border-red-500/40`}
          style={{ borderColor: 'var(--auth-danger-border)', color: 'var(--auth-text)' }}
        >
          DELETE
        </button>
      </div>

      {approveError && (
        <div className="text-[13px] mt-3" style={{ color: 'var(--auth-danger)' }}>{approveError}</div>
      )}
      {(notice || error) && (
        <div className="text-[13px] mt-3" style={{ color: error ? 'var(--auth-danger)' : 'var(--auth-muted)' }}>
          {error || notice}
        </div>
      )}
    </div>
  );
}
