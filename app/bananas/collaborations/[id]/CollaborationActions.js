'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import useSubmissionStatus from '@/app/bananas/components/useSubmissionStatus';
import { canResetSubmissionToNew } from '@/lib/submission-workflow';

export default function CollaborationActions({ collaborationId, currentStatus }) {
  const router = useRouter();
  const { status, working, notice, error, updateStatus } = useSubmissionStatus('collaborations', collaborationId, currentStatus);
  const [deleteError, setDeleteError] = useState('');

  const handleDelete = async () => {
    const confirmed = window.confirm('Permanently delete this submission?');
    if (!confirmed) return;

    setDeleteError('');
    const supabase = createClient();
    const { error } = await supabase
      .from('collaborations')
      .delete()
      .eq('id', collaborationId);

    if (error) {
      setDeleteError(error.message);
      return;
    }
    router.push('/bananas/collaborations');
    router.refresh();
  };

  const btnBase =
    'px-5 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.12em] transition-all hover:-translate-y-0.5 disabled:opacity-50';

  return (
    <div className="flex flex-wrap gap-2">
      {/* ── Approve ───────────────────────────────────── */}
      {status !== 'approved' && (
        <button
          onClick={() => updateStatus('approved')}
          disabled={working}
          className={`${btnBase} auth-theme-solid-button`}
        >
          APPROVE
        </button>
      )}

      {/* ── Mark Reviewed ─────────────────────────────── */}
      {status !== 'reviewed' && status !== 'approved' && status !== 'rejected' && (
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
          MARK AS SEEN
        </button>
      )}

      {canResetSubmissionToNew(status) && (
        <button
          onClick={() => updateStatus('new')}
          disabled={working}
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
          disabled={working}
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
          disabled={working}
          className={`${btnBase} border hover:bg-red-500/10 hover:border-red-500/40`}
          style={{ borderColor: 'var(--auth-danger-border)', color: 'var(--auth-text)' }}
        >
          REJECT
        </button>
      )}

      {/* ── Delete ────────────────────────────────────── */}
      <button
        onClick={handleDelete}
        disabled={working}
        className={`ml-auto ${btnBase} border hover:bg-red-500/10 hover:border-red-500/40`}
        style={{ borderColor: 'var(--auth-danger-border)', color: 'var(--auth-text)' }}
      >
        DELETE
      </button>
      {(notice || error || deleteError) && (
        <div className="basis-full text-[13px] mt-2" style={{ color: deleteError || error ? 'var(--auth-danger)' : 'var(--auth-muted)' }}>
          {deleteError || error || notice}
        </div>
      )}
    </div>
  );
}
