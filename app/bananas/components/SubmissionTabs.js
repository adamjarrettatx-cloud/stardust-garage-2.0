'use client';

import { countSubmissionStatuses, submissionTabsForType } from '@/lib/submission-workflow';

export default function SubmissionTabs({ type, rows, activeTab, onChange }) {
  const tabs = submissionTabsForType(type);
  const counts = countSubmissionStatuses(rows);

  return (
    <div className="flex gap-2 mb-8 flex-wrap" role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-semibold tracking-[0.1em] transition-colors"
            style={{
              background: isActive ? tab.color : 'var(--auth-ghost-bg)',
              color: isActive ? '#0a0a0a' : 'var(--auth-ghost-text)',
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              border: `1px solid ${isActive ? tab.color : 'var(--auth-ghost-border)'}`,
              cursor: 'pointer',
            }}
          >
            {tab.label}
            <span
              className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold leading-none"
              style={{
                background: isActive ? 'rgba(0,0,0,0.2)' : 'var(--auth-hover-bg)',
                color: isActive ? '#0a0a0a' : 'var(--auth-ghost-text)',
              }}
            >
              {counts[tab.id] || 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}
