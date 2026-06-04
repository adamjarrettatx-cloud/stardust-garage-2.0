'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function ApplicationActions({
  applicationId,
  currentStatus,
  accountCreated,
}) {
  const router = useRouter();
  const [working, setWorking] = useState(false);

  // Approving: call the API so we create an auth user + member profile
  // + send welcome email. The API is idempotent — calling it again on
  // an already-approved application is safe.
  const handleApprove = async () => {
    if (!accountCreated) {
      const confirmed = window.confirm(
        'Approve this application and create a member account?\n\n' +
          'A login email with a temporary password will be sent to the applicant.'
      );
      if (!confirmed) return;
    }

    setWorking(true);
    try {
      const res = await fetch('/api/admin/approve-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId }),
      });
      const body = await res.json();

      if (!res.ok) {
        alert('Error: ' + (body?.error || 'Failed to approve'));
        setWorking(false);
        return;
      }

      if (body.alreadyHadAccount) {
        alert('Application approved. (Member account was already active.)');
      } else if (body.passwordEmailed) {
        alert('Approved. Welcome email sent to the new member.');
      } else {
        alert(
          'Approved. The applicant\'s email was already a Supabase user — they keep their existing password.'
        );
      }

      router.refresh();
    } catch (err) {
      alert('Error: ' + (err?.message || 'Unknown'));
    } finally {
      setWorking(false);
    }
  };

  // Reject / mark pending: simple status update, no account changes
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

  return (
    <div className="flex flex-wrap gap-2">
      {currentStatus !== 'approved' && (
        <button
          onClick={handleApprove}
          disabled={working}
          className="px-5 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.12em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
          style={{ background: '#ffffff', color: '#0a0a0a' }}
        >
          {accountCreated ? 'APPROVE' : 'APPROVE & CREATE ACCOUNT'}
        </button>
      )}
      {currentStatus === 'approved' && !accountCreated && (
        <button
          onClick={handleApprove}
          disabled={working}
          className="px-5 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.12em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
          style={{ background: '#ffffff', color: '#0a0a0a' }}
        >
          CREATE MEMBER ACCOUNT
        </button>
      )}
      {currentStatus !== 'rejected' && (
        <button
          onClick={() => updateStatus('rejected')}
          disabled={working}
          className="px-5 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.12em] border transition-colors hover:bg-red-500/10 hover:border-red-500/40 disabled:opacity-50"
          style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
        >
          REJECT
        </button>
      )}
      {currentStatus !== 'pending' && (
        <button
          onClick={() => updateStatus('pending')}
          disabled={working}
          className="px-5 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.12em] border transition-colors hover:bg-white/5 disabled:opacity-50"
          style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
        >
          MARK PENDING
        </button>
      )}
      <button
        onClick={handleDelete}
        disabled={working}
        className="ml-auto px-5 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.12em] border transition-colors hover:bg-red-500/10 hover:border-red-500/40 disabled:opacity-50"
        style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
      >
        DELETE
      </button>
    </div>
  );
}
