'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import { normalizeSubmissionStatus, submissionStatusPresentation } from '@/lib/submission-workflow';

function buildNotice(nextStatus, changed) {
  if (!changed) {
    return `Already ${submissionStatusPresentation(nextStatus).label.toLowerCase()}.`;
  }
  return `Updated to ${submissionStatusPresentation(nextStatus).label.toLowerCase()}.`;
}

export default function useSubmissionStatus(type, id, initialStatus) {
  const router = useRouter();
  const [status, setStatus] = useState(normalizeSubmissionStatus(initialStatus));
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const updateStatus = async (nextStatus) => {
    setWorking(true);
    setNotice('');
    setError('');
    try {
      const body = await adminFetch(`/api/admin/submissions/${type}/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      setStatus(normalizeSubmissionStatus(body.status));
      setNotice(buildNotice(body.status, body.changed));
      router.refresh();
      return body;
    } catch (err) {
      setError(err?.message || 'Could not update the submission status.');
      return null;
    } finally {
      setWorking(false);
    }
  };

  return {
    status,
    working,
    notice,
    error,
    setError,
    setNotice,
    updateStatus,
  };
}
