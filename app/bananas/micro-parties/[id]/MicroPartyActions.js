'use client';

import useSubmissionStatus from '@/app/bananas/components/useSubmissionStatus';
import { canResetSubmissionToNew } from '@/lib/submission-workflow';

export default function MicroPartyActions({ inquiryId, currentStatus }) {
  const { status, working, notice, error, updateStatus } = useSubmissionStatus('micro-parties', inquiryId, currentStatus);

  const btnBase =
    'px-5 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5 disabled:opacity-50';

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {/* ── Approve ───────────────────────────────────── */}
        <button
          type="button"
          disabled={working || status === 'approved'}
          onClick={() => updateStatus('approved')}
          className={`${btnBase} ${status === 'approved' ? '' : 'auth-theme-solid-button'}`}
          style={{
            background: status === 'approved' ? 'var(--auth-success-bg)' : undefined,
            color: status === 'approved' ? 'var(--auth-success)' : undefined,
            border: status === 'approved' ? '1px solid var(--auth-success-border)' : 'none',
          }}
        >
          {status === 'approved' ? '✓ APPROVED' : 'APPROVE'}
        </button>

        {/* ── Mark Reviewed ─────────────────────────────── */}
        {status !== 'reviewed' && status !== 'approved' && status !== 'rejected' && (
          <button
            type="button"
            disabled={working}
            onClick={() => updateStatus('reviewed')}
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
            type="button"
            disabled={working}
            onClick={() => updateStatus('new')}
            className={btnBase}
            style={{
              background: 'transparent',
              color: 'var(--auth-warn-strong)',
              border: '1px solid var(--auth-warn-border)',
            }}
          >
            MARK AS NEW
          </button>
        )}

        {/* ── Mark Pending ──────────────────────────────── */}
        {status !== 'pending' && (
          <button
            type="button"
            disabled={working}
            onClick={() => updateStatus('pending')}
            className={`${btnBase} auth-theme-border-button`}
            style={{
              background: 'transparent',
              color: 'var(--auth-muted-strong)',
              border: '1px solid var(--auth-ghost-border)',
            }}
          >
            MARK PENDING
          </button>
        )}

        {/* ── Reject ────────────────────────────────────── */}
        <button
          type="button"
          disabled={working || status === 'rejected'}
          onClick={() => updateStatus('rejected')}
          className={btnBase}
          style={{
            background: status === 'rejected' ? 'var(--auth-danger-bg)' : 'transparent',
            color: status === 'rejected' ? 'var(--auth-danger)' : 'var(--auth-text)',
            border: '1px solid var(--auth-danger-border)',
          }}
        >
          {status === 'rejected' ? '✗ REJECTED' : 'REJECT'}
        </button>
      </div>

      {(notice || error) && (
        <div className="text-[13px] mt-3" style={{ color: error ? 'var(--auth-danger)' : 'var(--auth-muted)' }}>
          {error || notice}
        </div>
      )}
    </div>
  );
}
