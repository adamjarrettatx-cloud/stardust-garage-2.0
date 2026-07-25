import { submissionStatusPresentation } from '@/lib/submission-workflow';

export default function SubmissionStatusBadge({ status }) {
  const meta = submissionStatusPresentation(status);

  return (
    <span
      className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full uppercase"
      style={{
        background: meta.bg,
        color: meta.color,
        border: `1px solid ${meta.color}33`,
      }}
    >
      {meta.label}
    </span>
  );
}
