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

const ROLE_LABELS = {
  djs: 'DJ',
  artists: 'ARTIST',
};

export default function CollaborationsList({ collabs }) {
  const [activeTab, setActiveTab] = useState('new');
  const visible = filterSubmissionRowsByStatus(collabs, activeTab);
  const activeLabel = activeTab === 'reviewed' ? 'seen' : activeTab.toLowerCase();

  return (
    <>
      <SubmissionTabs type="collaborations" rows={collabs} activeTab={activeTab} onChange={setActiveTab} />

      {/* List */}
      {visible.length === 0 ? (
        <div
          className="rounded-[14px] p-12 text-center border"
          style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
        >
          <p style={{ color: 'var(--auth-muted)' }}>
            No {activeLabel} collaboration submissions.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((c) => (
            <Link
              key={c.id}
              href={`/bananas/collaborations/${c.id}`}
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
                      {c.full_name}
                    </h3>
                    <span className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
                      {c.applying_for}
                    </span>
                  </div>
                  <div
                    className="text-[13px] flex flex-wrap gap-x-4 gap-y-1"
                    style={{ color: 'var(--auth-muted)' }}
                  >
                    <span>{c.email}</span>
                    <span>{c.phone}</span>
                    {c.instagram_handle && <span>{c.instagram_handle}</span>}
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div
                    className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full mb-2"
                    style={{
                      background: 'var(--auth-card-bg-alt)',
                      color: 'var(--auth-text)',
                      border: '1px solid var(--auth-card-border-strong)',
                    }}
                  >
                    {ROLE_LABELS[c.collaborator_type] || c.collaborator_type?.toUpperCase()}
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--auth-faint)' }}>
                    {formatDate(c.created_at)}
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
