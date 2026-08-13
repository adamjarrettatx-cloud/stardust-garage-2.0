'use client';

import useSubmissionStatus from './useSubmissionStatus';
import { submissionActionsForStatus } from '@/lib/submission-workflow';

const BTN_BASE =
  'px-5 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.12em] transition-all hover:-translate-y-0.5 disabled:opacity-50';

const BTN_STYLES = {
  seen: {
    className: BTN_BASE,
    style: {
      background: 'rgba(56,189,248,0.12)',
      color: '#38bdf8',
      border: '1px solid rgba(56,189,248,0.3)',
    },
  },
  contacted: {
    className: BTN_BASE,
    style: {
      background: 'rgba(168,85,247,0.12)',
      color: '#c084fc',
      border: '1px solid rgba(168,85,247,0.3)',
    },
  },
  pending: {
    className: `${BTN_BASE} border auth-theme-border-button`,
    style: { color: 'var(--auth-muted-strong)' },
  },
  approved: {
    className: `${BTN_BASE} auth-theme-solid-button`,
    style: undefined,
  },
  rejected: {
    className: `${BTN_BASE} border hover:bg-red-500/10 hover:border-red-500/40`,
    style: { borderColor: 'var(--auth-danger-border)', color: 'var(--auth-text)' },
  },
};

export default function SubmissionActions({
  type,
  id,
  currentStatus,
  onApprove,
  approveLabel,
  busy: externalBusy = false,
  children,
}) {
  const { status, working, notice, error, updateStatus } = useSubmissionStatus(type, id, currentStatus);
  const busy = working || externalBusy;
  const actions = submissionActionsForStatus(status);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={action.status}
            type="button"
            disabled={busy}
            onClick={
              action.status === 'approved' && onApprove ? onApprove : () => updateStatus(action.status)
            }
            className={BTN_STYLES[action.status].className}
            style={BTN_STYLES[action.status].style}
          >
            {(action.status === 'approved' && approveLabel ? approveLabel : action.label).toUpperCase()}
          </button>
        ))}
        {children}
      </div>

      {(notice || error) && (
        <div className="text-[13px] mt-3" style={{ color: error ? 'var(--auth-danger)' : 'var(--auth-muted)' }}>
          {error || notice}
        </div>
      )}
    </div>
  );
}
