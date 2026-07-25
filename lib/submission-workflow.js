export const SUBMISSION_STATUS_META = {
  new: {
    value: 'new',
    label: 'New',
    tabLabel: 'New',
    buttonLabel: 'Mark as seen',
    color: '#ffb84d',
    bg: 'rgba(255,184,77,0.15)',
  },
  reviewed: {
    value: 'reviewed',
    label: 'Seen',
    tabLabel: 'Seen',
    buttonLabel: 'Mark as seen',
    color: '#c084fc',
    bg: 'rgba(168,85,247,0.12)',
  },
  pending: {
    value: 'pending',
    label: 'Pending',
    tabLabel: 'Pending',
    buttonLabel: 'Mark pending',
    color: '#a0a0a0',
    bg: 'rgba(255,255,255,0.06)',
  },
  approved: {
    value: 'approved',
    label: 'Approved',
    tabLabel: 'Approved',
    buttonLabel: 'Approve',
    color: '#4ade80',
    bg: 'rgba(34,197,94,0.15)',
  },
  rejected: {
    value: 'rejected',
    label: 'Rejected',
    tabLabel: 'Rejected',
    buttonLabel: 'Reject',
    color: '#f87171',
    bg: 'rgba(239,68,68,0.15)',
  },
};

export const SUBMISSION_LIST_TABS = [
  { id: 'new', label: SUBMISSION_STATUS_META.new.tabLabel, color: SUBMISSION_STATUS_META.new.color },
  { id: 'reviewed', label: SUBMISSION_STATUS_META.reviewed.tabLabel, color: SUBMISSION_STATUS_META.reviewed.color },
  { id: 'pending', label: SUBMISSION_STATUS_META.pending.tabLabel, color: SUBMISSION_STATUS_META.pending.color },
  { id: 'approved', label: SUBMISSION_STATUS_META.approved.tabLabel, color: SUBMISSION_STATUS_META.approved.color },
  { id: 'rejected', label: SUBMISSION_STATUS_META.rejected.tabLabel, color: SUBMISSION_STATUS_META.rejected.color },
];

export const SUBMISSION_TYPE_CONFIGS = {
  applications: {
    type: 'applications',
    table: 'membership_applications',
    routeBase: '/bananas/applications',
    noun: 'application',
    tabs: ['new', 'reviewed', 'pending', 'approved', 'rejected'],
  },
  collaborations: {
    type: 'collaborations',
    table: 'collaborations',
    routeBase: '/bananas/collaborations',
    noun: 'collaboration submission',
    tabs: ['new', 'reviewed', 'pending', 'approved', 'rejected'],
  },
  'micro-parties': {
    type: 'micro-parties',
    table: 'micro_party_inquiries',
    routeBase: '/bananas/micro-parties',
    noun: 'micro party inquiry',
    tabs: ['new', 'reviewed', 'pending', 'approved', 'rejected'],
  },
  signups: {
    type: 'signups',
    table: 'signups',
    routeBase: '/bananas/signups',
    noun: 'signup',
    tabs: ['new', 'reviewed'],
  },
  'venue-inquiries': {
    type: 'venue-inquiries',
    table: 'venue_inquiries',
    routeBase: '/bananas/venue-inquiries',
    noun: 'venue inquiry',
    tabs: ['new', 'reviewed', 'pending', 'approved', 'rejected'],
  },
};

const SUBMISSION_STATUSES = new Set(Object.keys(SUBMISSION_STATUS_META));
const RESETTABLE_TO_NEW = new Set(['reviewed', 'pending']);

export function normalizeSubmissionStatus(status) {
  return SUBMISSION_STATUSES.has(status) ? status : 'new';
}

export function resolveSubmissionTypeConfig(type) {
  return SUBMISSION_TYPE_CONFIGS[type] || null;
}

export function isSubmissionStatus(status) {
  return SUBMISSION_STATUSES.has(status);
}

export function canResetSubmissionToNew(status) {
  return RESETTABLE_TO_NEW.has(normalizeSubmissionStatus(status));
}

export function canExplicitlyTransitionSubmission(currentStatus, nextStatus) {
  const current = normalizeSubmissionStatus(currentStatus);
  const next = normalizeSubmissionStatus(nextStatus);
  if (current === next) return true;
  if (next === 'new') return canResetSubmissionToNew(current);
  return next === 'reviewed' || next === 'pending' || next === 'approved' || next === 'rejected';
}

export function countSubmissionStatuses(rows = []) {
  const counts = Object.fromEntries(
    Object.keys(SUBMISSION_STATUS_META).map((status) => [status, 0]),
  );

  for (const row of rows) {
    const status = normalizeSubmissionStatus(row?.status);
    counts[status] += 1;
  }

  return counts;
}

export function filterSubmissionRowsByStatus(rows = [], activeStatus = 'new') {
  const status = normalizeSubmissionStatus(activeStatus);
  return (rows || []).filter((row) => normalizeSubmissionStatus(row?.status) === status);
}

export function submissionStatusPresentation(status) {
  return SUBMISSION_STATUS_META[normalizeSubmissionStatus(status)] || SUBMISSION_STATUS_META.new;
}

export function explicitStatusActionLabel(status) {
  return submissionStatusPresentation(status).buttonLabel;
}

export function submissionTabsForType(type) {
  const config = resolveSubmissionTypeConfig(type);
  const tabIds = config?.tabs || SUBMISSION_LIST_TABS.map((tab) => tab.id);
  return SUBMISSION_LIST_TABS.filter((tab) => tabIds.includes(tab.id));
}
