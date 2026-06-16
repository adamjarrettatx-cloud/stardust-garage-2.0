'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { adminFetch } from '@/lib/admin-fetch';

export default function ApplicationActions({
  applicationId,
  currentStatus,
  accountCreated,
  hasPhoto,
}) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [approveError, setApproveError] = useState('');

  // Auto-mark as reviewed when the detail page is first opened (if still 'new')
  useEffect(() => {
    if (currentStatus === 'new') {
      const supabase = createClient();
      supabase
        .from('membership_applications')
        .update({ status: 'reviewed' })
        .eq('id', applicationId)
        .then(() => router.refresh());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    setWorking(true);
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
      setWorking(false);
    }
  };

  const updateStatus = async (newStatus) => {
    setWorking(true);
    const supabase = createClient();
    const { error } = await supabase
      .from('membership_applications')
      .update({ status: newStatus })
      .eq('id', applicationId);

    if (error) {
      alert('Error: ' + error.message);
      setWorking(false);
      return;
    }
    router.refresh();
    setWorking(false);
  };

  const handleDelete = async () => {
    const confirmed = window.confirm('Permanently delete this application?');
    if (!confirmed) return;

    setWorking(true);
    const supabase = createClient();
    const { error } = await supabase
      .from('membership_applications')
      .delete()
      .eq('id', applicationId);

    if (error) {
      alert('Error: ' + error.message);
      setWorking(false);
      return;
    }
    router.push('/admin/applications');
    router.refresh();
  };

  const btnBase =
    'px-5 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.12em] transition-all hover:-translate-y-0.5 disabled:opacity-50';

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {/* ── Accept / create account ───────────────────── */}
        {currentStatus !== 'approved' && (
          <button
            onClick={handleApprove}
            disabled={working}
            className={btnBase}
            style={{ background: '#ffffff', color: '#0a0a0a' }}
          >
            {accountCreated ? 'ACCEPT' : 'ACCEPT & CREATE ACCOUNT'}
          </button>
        )}
        {currentStatus === 'approved' && !accountCreated && (
          <button
            onClick={handleApprove}
            disabled={working}
            className={btnBase}
            style={{ background: '#ffffff', color: '#0a0a0a' }}
          >
            CREATE MEMBER ACCOUNT
          </button>
        )}

        {/* ── Mark Reviewed ─────────────────────────────── */}
        {currentStatus !== 'reviewed' && currentStatus !== 'approved' && currentStatus !== 'rejected' && (
          <button
            onClick={() => updateStatus('reviewed')}
            disabled={working}
            className={btnBase}
            style={{
              background: 'rgba(168,85,247,0.12)',
              color: '#c084fc',
              border: '1px solid rgba(168,85,247,0.3)',
            }}
          >
            MARK REVIEWED
          </button>
        )}

        {/* ── Mark Pending ──────────────────────────────── */}
        {currentStatus !== 'pending' && (
          <button
            onClick={() => updateStatus('pending')}
            disabled={working}
            className={`${btnBase} border hover:bg-white/5`}
            style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
          >
            MARK PENDING
          </button>
        )}

        {/* ── Reject ────────────────────────────────────── */}
        {currentStatus !== 'rejected' && (
          <button
            onClick={() => updateStatus('rejected')}
            disabled={working}
            className={`${btnBase} border hover:bg-red-500/10 hover:border-red-500/40`}
            style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
          >
            REJECT
          </button>
        )}

        {/* ── Delete ────────────────────────────────────── */}
        <button
          onClick={handleDelete}
          disabled={working}
          className={`ml-auto ${btnBase} border hover:bg-red-500/10 hover:border-red-500/40`}
          style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
        >
          DELETE
        </button>
      </div>

      {approveError && (
        <div className="text-[13px] text-red-400 mt-3">{approveError}</div>
      )}
    </div>
  );
}
