// Shared display helpers for the admin Members list and the member profile
// page. Both render the same status chip, avatar and plan line, so the labels
// and the tone lookup live here rather than being duplicated (and drifting) in
// two files.
//
// Every colour is an --auth-* variable. The old version of this page hard-coded
// #141414 cards, #8a8a8a labels and #555 metadata, which is why it stayed
// near-black after the rest of the admin panel gained the light/dark toggle.

export const MEMBER_STATUS_LABEL = {
  active: 'ACTIVE',
  past_due: 'PAYMENT FAILED',
  cancelled: 'CANCELLED',
  pending: 'PENDING ACTIVATION',
  incomplete: 'INCOMPLETE',
};

const MEMBER_STATUS_TONE = {
  active: { bg: 'var(--auth-success-bg)', fg: 'var(--auth-success)' },
  past_due: { bg: 'var(--auth-warn-bg)', fg: 'var(--auth-warn)' },
  cancelled: { bg: 'var(--auth-danger-bg)', fg: 'var(--auth-danger)' },
  pending: { bg: 'var(--auth-hover-bg-strong)', fg: 'var(--auth-muted-strong)' },
  incomplete: { bg: 'var(--auth-danger-bg)', fg: 'var(--auth-danger)' },
};

const FALLBACK_TONE = { bg: 'var(--auth-hover-bg-strong)', fg: 'var(--auth-muted-strong)' };

export function memberStatusLabel(status) {
  return MEMBER_STATUS_LABEL[status] || 'UNKNOWN';
}

export function memberStatusTone(status) {
  return MEMBER_STATUS_TONE[status] || FALLBACK_TONE;
}

export function formatMemberDate(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function memberInitials(name, email) {
  const source = (name || email || '').trim();
  if (!source) return '?';
  return (
    source
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('') || '?'
  );
}
