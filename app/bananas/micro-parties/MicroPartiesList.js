'use client';

import { useState } from 'react';
import Link from 'next/link';
import SubmissionTabs from '@/app/bananas/components/SubmissionTabs';
import { filterSubmissionRowsByStatus } from '@/lib/submission-workflow';

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

function formatEventDate(dateString) {
  if (!dateString) return '';
  return new Date(dateString + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function MicroPartiesList({ inquiries }) {
  const [activeTab, setActiveTab] = useState('new');
  const visible = filterSubmissionRowsByStatus(inquiries, activeTab);
  const activeLabel = activeTab.toLowerCase();

  return (
    <>
      <SubmissionTabs type="micro-parties" rows={inquiries} activeTab={activeTab} onChange={setActiveTab} />

      {/* List */}
      {visible.length === 0 ? (
        <div
          className="rounded-[14px] p-12 text-center border"
          style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
        >
          <p style={{ color: 'var(--auth-muted)' }}>
            No {activeLabel} micro party inquiries.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((i) => (
            <Link
              key={i.id}
              href={`/bananas/micro-parties/${i.id}`}
              className="block rounded-[14px] p-6 border transition-colors hover:border-white/20"
              style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1 flex-wrap">
                    <h3
                      className="text-[18px] font-bold"
                      style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                    >
                      {i.event_name || i.full_name}
                    </h3>
                    {i.event_type && (
                      <span className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
                        {i.event_type}
                      </span>
                    )}
                  </div>
                  <div
                    className="text-[13px] flex flex-wrap gap-x-4 gap-y-1"
                    style={{ color: 'var(--auth-muted)' }}
                  >
                    <span>{i.full_name}</span>
                    <span>{i.email}</span>
                    {i.event_date && <span>{formatEventDate(i.event_date)}</span>}
                    {i.expected_attendance && <span>{i.expected_attendance} ppl</span>}
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className="text-[11px]" style={{ color: 'var(--auth-faint)' }}>
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
