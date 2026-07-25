'use client';

import useSubmissionStatus from './useSubmissionStatus';

export default function SignupStatusButton({ signupId, currentStatus }) {
  const { status, working, notice, error, updateStatus } = useSubmissionStatus('signups', signupId, currentStatus);
  const isNew = status === 'new';

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => updateStatus(isNew ? 'reviewed' : 'new')}
        disabled={working}
        className="px-3 py-1.5 rounded-full text-[10px] font-semibold tracking-[0.12em] border transition-colors disabled:opacity-50"
        style={{
          borderColor: isNew ? 'var(--auth-warn-border)' : 'var(--auth-ghost-border)',
          color: isNew ? 'var(--auth-warn-strong)' : 'var(--auth-ghost-text)',
          background: isNew ? 'var(--auth-warn-bg)' : 'transparent',
        }}
      >
        {working ? '...' : isNew ? 'MARK AS SEEN' : 'MARK AS NEW'}
      </button>
      {(notice || error) && (
        <span className="text-[10px]" style={{ color: error ? 'var(--auth-danger)' : 'var(--auth-muted)' }}>
          {error || notice}
        </span>
      )}
    </div>
  );
}
