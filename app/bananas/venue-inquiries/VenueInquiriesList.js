'use client';

import { useState } from 'react';
import Link from 'next/link';

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const TYPE_LABELS = {
  'micro-parties': 'MICRO PARTIES',
  'host-your-own': 'HOST-YOUR-OWN',
  'entire-space': 'ENTIRE SPACE',
};

const TABS = [
  { id: 'new',      label: 'New',      color: 'var(--st-ffb84d)' },
  { id: 'reviewed', label: 'Reviewed', color: 'var(--st-c084fc)' },
  { id: 'pending',  label: 'Pending',  color: 'var(--text-3)' },
  { id: 'approved', label: 'Approved', color: 'var(--st-4ade80)' },
];

export default function VenueInquiriesList({ inquiries }) {
  const counts = Object.fromEntries(
    TABS.map((t) => [t.id, inquiries.filter((i) => i.status === t.id).length])
  );

  const [activeTab, setActiveTab] = useState('new');
  const visible = inquiries.filter((i) => i.status === activeTab);
  const activeTabDef = TABS.find((t) => t.id === activeTab);

  return (
    <>
      {/* Tab bar */}
      <div className="flex gap-2 mb-8 flex-wrap" role="tablist">
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-semibold tracking-[0.1em] transition-colors"
              style={{
                background: isActive ? tab.color : 'var(--fg-a06)',
                color: isActive ? '#0a0a0a' : 'var(--text-2)',
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {tab.label}
              <span
                className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold leading-none"
                style={{
                  background: isActive ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.1)',
                  color: isActive ? '#0a0a0a' : 'var(--text-2)',
                }}
              >
                {counts[tab.id]}
              </span>
            </button>
          );
        })}
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <div
          className="rounded-[14px] p-12 text-center border"
          style={{ background: 'var(--surface-1)', borderColor: 'var(--fg-a05)' }}
        >
          <p style={{ color: 'var(--text-3)' }}>
            No {activeTabDef?.label.toLowerCase()} venue inquiries.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((i) => (
            <Link
              key={i.id}
              href={`/bananas/venue-inquiries/${i.id}`}
              className="block rounded-[14px] p-6 border transition-colors hover:border-white/20"
              style={{ background: 'var(--surface-1)', borderColor: 'var(--fg-a05)' }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3
                      className="text-[18px] font-bold"
                      style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                    >
                      {i.event_name}
                    </h3>
                    <span className="text-[13px]" style={{ color: 'var(--text-3)' }}>
                      {i.event_type}
                    </span>
                  </div>
                  <div
                    className="text-[13px] flex flex-wrap gap-x-4 gap-y-1"
                    style={{ color: 'var(--text-3)' }}
                  >
                    <span>{i.full_name}</span>
                    <span>{i.email}</span>
                    <span>{i.preferred_dates}</span>
                    <span>{i.expected_attendance}</span>
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  {i.inquiry_type && TYPE_LABELS[i.inquiry_type] && (
                    <div
                      className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full mb-2"
                      style={{
                        background: 'var(--surface-4)',
                        color: 'var(--text-1)',
                        border: '1px solid var(--fg-a1)',
                      }}
                    >
                      {TYPE_LABELS[i.inquiry_type]}
                    </div>
                  )}
                  <div className="text-[11px] mt-2" style={{ color: 'var(--text-4)' }}>
                    {formatDate(i.created_at)}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
