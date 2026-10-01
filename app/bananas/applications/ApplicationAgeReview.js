import { AGE_REVIEW_TITLE } from '@/lib/membership-age-review';

// The parent server page derives this from the stored birthday and submitted
// timestamp. This is a review flag, not approval or an admission credential.
export default function ApplicationAgeReview({ review, compact = false }) {
  if (!review?.required) return null;
  return (
    <aside
      data-testid={compact ? 'application-age-review-badge' : 'application-age-review-banner'}
      style={{
        margin: compact ? '10px 0 0' : '0 0 16px',
        padding: compact ? '8px 10px' : '16px 20px',
        borderRadius: compact ? 8 : 12,
        border: '1px solid var(--auth-warn-border)',
        background: 'var(--auth-warn-bg)',
        color: 'var(--auth-warn-strong)',
        fontSize: compact ? 12 : 13,
        lineHeight: 1.5,
      }}
    >
      <strong style={{ display: 'block' }}>{AGE_REVIEW_TITLE}</strong>
      <span>Age {review.age}{review.atSubmission ? ' at application' : ''}.</span>
      {!compact && (
        <p style={{ margin: '8px 0 0' }}>
          This applicant is in the 21–22 age group. Complete additional screening
          before approving through the usual membership process. This flag does
          not grant membership or venue access.
        </p>
      )}
    </aside>
  );
}
