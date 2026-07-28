// Pure helpers for the admin-curated "Potential Members" list — a
// pre-application CRM-style list under Community so admins can jot down
// people they want as members before those people ever submit the public
// membership application. See supabase/migrations/20260728_potential_members.sql.

// Colors reference the shared authenticated-theme CSS variables (see
// lib/authenticated-theme.js) so each status badge automatically gets the
// right, readable-in-both-themes color — lighter/brighter on dark admin
// pages, darker/deeper on light ones — instead of one fixed hex value that
// only looks right against a dark background.
export const POTENTIAL_MEMBER_STATUS_META = {
  potential: {
    value: 'potential',
    label: 'Potential',
    color: 'var(--auth-warn-strong)',
    bg: 'var(--auth-warn-bg)',
    border: 'var(--auth-warn-border)',
  },
  contacted: {
    value: 'contacted',
    label: 'Contacted',
    color: 'var(--auth-violet-strong)',
    bg: 'var(--auth-violet-bg)',
    border: 'var(--auth-violet-border)',
  },
  invited: {
    value: 'invited',
    label: 'Invited to apply',
    color: 'var(--auth-info-strong)',
    bg: 'var(--auth-info-bg)',
    border: 'var(--auth-info-border)',
  },
  converted: {
    value: 'converted',
    label: 'Became a member',
    color: 'var(--auth-success-strong)',
    bg: 'var(--auth-success-bg)',
    border: 'var(--auth-success-border)',
  },
  archived: {
    value: 'archived',
    label: 'Archived',
    color: 'var(--auth-muted-strong)',
    bg: 'var(--auth-ghost-bg)',
    border: 'var(--auth-ghost-border)',
  },
};

export const POTENTIAL_MEMBER_STATUSES = Object.keys(POTENTIAL_MEMBER_STATUS_META);

// converted/archived are terminal; everything else can still move forward or
// be archived. Nothing moves backward automatically, but any of the active
// statuses can jump straight to archived (a potential member falling through
// doesn't need to be walked backward through the pipeline first).
const ALLOWED_TRANSITIONS = {
  potential: ['contacted', 'invited', 'archived'],
  contacted: ['invited', 'converted', 'archived'],
  invited: ['converted', 'archived'],
  converted: [],
  archived: [],
};

export function isPotentialMemberStatus(status) {
  return POTENTIAL_MEMBER_STATUSES.includes(status);
}

export function normalizePotentialMemberStatus(status) {
  return isPotentialMemberStatus(status) ? status : 'potential';
}

export function potentialMemberStatusPresentation(status) {
  return POTENTIAL_MEMBER_STATUS_META[normalizePotentialMemberStatus(status)];
}

export function canTransitionPotentialMember(currentStatus, nextStatus) {
  const current = normalizePotentialMemberStatus(currentStatus);
  const next = normalizePotentialMemberStatus(nextStatus);
  if (current === next) return true;
  return (ALLOWED_TRANSITIONS[current] || []).includes(next);
}

export function potentialMemberActionsForStatus(status) {
  const current = normalizePotentialMemberStatus(status);
  return (ALLOWED_TRANSITIONS[current] || []).map((next) => ({
    status: next,
    label: POTENTIAL_MEMBER_STATUS_META[next].label,
  }));
}

// Trims + validates the create-profile form payload. Only full_name is
// required — phone/email/notes are all optional so a name jotted down on the
// spot is enough to start the entry.
export function validatePotentialMemberInput(body) {
  const fullName = (body?.full_name || '').trim();
  if (!fullName) {
    return { valid: false, error: 'Full name is required.' };
  }
  return {
    valid: true,
    data: {
      full_name: fullName,
      phone: (body?.phone || '').trim() || null,
      email: (body?.email || '').trim() || null,
      notes: (body?.notes || '').trim() || null,
    },
  };
}

// Builds a partial update payload for PATCH from whichever fields were sent.
// Returns { error } if a provided field fails validation, otherwise
// { updates } (which may legitimately be empty if only unknown keys were sent).
export function buildPotentialMemberUpdates(body) {
  const updates = {};

  if (body?.status !== undefined) {
    if (!isPotentialMemberStatus(body.status)) {
      return { error: 'Invalid status.' };
    }
    updates.status = body.status;
  }

  if (body?.full_name !== undefined) {
    const fullName = (body.full_name || '').trim();
    if (!fullName) {
      return { error: 'Full name cannot be empty.' };
    }
    updates.full_name = fullName;
  }

  if (body?.phone !== undefined) updates.phone = (body.phone || '').trim() || null;
  if (body?.email !== undefined) updates.email = (body.email || '').trim() || null;
  if (body?.notes !== undefined) updates.notes = (body.notes || '').trim() || null;

  return { updates };
}
