'use client';

import useSubmissionStatus from './useSubmissionStatus';

export default function SignupStatusButton({ signupId, currentStatus }) {
  const { status, working, notice, error, updateStatus } = useSubmissionStatus('signups', signupId, currentStatus);

  if (status !== 'new') return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => updateStatus('contacted')}
        disabled={working}
        className="px-3 py-1.5 rounded-full text-[10px] font-semibold tracking-[0.12em] border transition-colors disabled:opacity-50"
        style={{
          borderColor: 'var(--auth-warn-border)',
          color: 'var(--auth-warn-strong)',
          background: 'var(--auth-warn-bg)',
        }}
      >
        {working ? '...' : 'CONTACTED'}
      </button>
      {(notice || error) && (
        <span className="text-[10px]" style={{ color: error ? 'var(--auth-danger)' : 'var(--auth-muted)' }}>
          {error || notice}
        </span>
      )}
    </div>
  );
}
