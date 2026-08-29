'use client';

import { countSubmissionStatuses, submissionTabsForType } from '@/lib/submission-workflow';
import UnderlineTabs from './UnderlineTabs';

// Status filter strip for the five submission list pages (Membership
// Applications, Collaborations, Signups, Venue Inquiries, Micro Parties).
//
// This used to render its own filled pills. The presentation now lives in
// UnderlineTabs, shared with Contacts and Artist Pay, so all seven in-page
// filters look like one thing. This component keeps what is actually specific
// to submissions: which statuses a given type exposes, and the row counts.
export default function SubmissionTabs({ type, rows, activeTab, onChange }) {
  const tabs = submissionTabsForType(type);
  const counts = countSubmissionStatuses(rows);

  return (
    <UnderlineTabs
      tabs={tabs.map((tab) => ({
        id: tab.id,
        label: tab.label,
        color: tab.color,
        count: counts[tab.id] || 0,
      }))}
      active={activeTab}
      onChange={onChange}
      ariaLabel="Filter by status"
    />
  );
}
