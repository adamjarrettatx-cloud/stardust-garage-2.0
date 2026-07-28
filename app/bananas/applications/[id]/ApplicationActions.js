'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import SubmissionActions from '@/app/bananas/components/SubmissionActions';
import { normalizeSubmissionStatus } from '@/lib/submission-workflow';

export default function ApplicationActions({
  applicationId,
  currentStatus,
  accountCreated,
  hasPhoto,
}) {
  const router = useRouter();
  const [approveError, setApproveError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const status = normalizeSubmissionStatus(currentStatus);

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

  return (
    <div>
      <SubmissionActions
        type="applications"
        id={applicationId}
        currentStatus={currentStatus}
        onApprove={handleApprove}
        approveLabel="Accept & create account"
        busy={actionBusy}
      >
        {status === 'approved' && !accountCreated && (
          <button
            type="button"
            onClick={handleApprove}
            disabled={actionBusy}
            className="px-5 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.12em] transition-all hover:-translate-y-0.5 disabled:opacity-50 auth-theme-solid-button"
          >
            CREATE MEMBER ACCOUNT
          </button>
        )}
      </SubmissionActions>

      {approveError && (
        <div className="text-[13px] mt-3" style={{ color: 'var(--auth-danger)' }}>{approveError}</div>
      )}
    </div>
  );
}
