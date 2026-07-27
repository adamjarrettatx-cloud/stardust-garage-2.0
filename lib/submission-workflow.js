export const SUBMISSION_STATUS_META = {
  new: {
    value: 'new',
    label: 'New',
    tabLabel: 'New',
    buttonLabel: 'Mark as new',
    color: '#ffb84d',
    bg: 'rgba(255,184,77,0.15)',
  },
  contacted: {
    value: 'contacted',
    label: 'Contacted',
    tabLabel: 'Contacted',
    buttonLabel: 'Contacted',
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
  { id: 'contacted', label: SUBMISSION_STATUS_META.contacted.tabLabel, color: SUBMISSION_STATUS_META.contacted.color },
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
    tabs: ['new', 'contacted', 'pending', 'approved', 'rejected'],
  },
  collaborations: {
    type: 'collaborations',
    table: 'collaborations',
    routeBase: '/bananas/collaborations',
    noun: 'collaboration submission',
    tabs: ['new', 'contacted', 'pending', 'approved', 'rejected'],
  },
  'micro-parties': {
    type: 'micro-parties',
    table: 'micro_party_inquiries',
    routeBase: '/bananas/micro-parties',
    noun: 'micro party inquiry',
    tabs: ['new', 'contacted', 'pending', 'approved', 'rejected'],
  },
  signups: {
    type: 'signups',
    table: 'signups',
    routeBase: '/bananas/signups',
    noun: 'signup',
    tabs: ['new', 'contacted'],
  },
  'venue-inquiries': {
    type: 'venue-inquiries',
    table: 'venue_inquiries',
    routeBase: '/bananas/venue-inquiries',
    noun: 'venue inquiry',
    tabs: ['new', 'contacted', 'pending', 'approved', 'rejected'],
  },
};

const SUBMISSION_STATUSES = new Set(Object.keys(SUBMISSION_STATUS_META));

// new → contacted | pending → approved | rejected. Approved and rejected are
// terminal, and nothing ever moves back to new: viewing a submission never
// changes its status.
const ALLOWED_TRANSITIONS = {
  new: ['contacted', 'pending'],
  contacted: ['approved', 'rejected'],
  pending: ['approved', 'rejected'],
  approved: [],
  rejected: [],
};

export function normalizeSubmissionStatus(status) {
  return SUBMISSION_STATUSES.has(status) ? status : 'new';
}

export function resolveSubmissionTypeConfig(type) {
  return SUBMISSION_TYPE_CONFIGS[type] || null;
}

export function isSubmissionStatus(status) {
  return SUBMISSION_STATUSES.has(status);
}

export function canExplicitlyTransitionSubmission(currentStatus, nextStatus) {
  const current = normalizeSubmissionStatus(currentStatus);
  const next = normalizeSubmissionStatus(nextStatus);
  if (current === next) return true;
  return ALLOWED_TRANSITIONS[current].includes(next);
}

export function submissionActionsForStatus(status) {
  const current = normalizeSubmissionStatus(status);
  return ALLOWED_TRANSITIONS[current].map((next) => ({
    status: next,
    label: SUBMISSION_STATUS_META[next].buttonLabel,
  }));
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

export function submissionTabsForType(type) {
  const config = resolveSubmissionTypeConfig(type);
  const tabIds = config?.tabs || SUBMISSION_LIST_TABS.map((tab) => tab.id);
  return SUBMISSION_LIST_TABS.filter((tab) => tabIds.includes(tab.id));
}
