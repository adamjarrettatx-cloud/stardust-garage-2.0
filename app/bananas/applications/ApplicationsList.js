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

function initials(name) {
  if (!name) return '?';
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('') || '?'
  );
}

function Avatar({ application }) {
  if (application.photo_url) {
    return (
      <img
        src={application.photo_url}
        alt={application.full_name}
        className="w-11 h-11 flex-shrink-0 object-cover"
        style={{ borderRadius: '50%', border: '1px solid var(--auth-card-border-strong)' }}
      />
    );
  }
  return (
    <div
      className="w-11 h-11 flex-shrink-0 flex items-center justify-center text-[14px] font-bold"
      style={{
        borderRadius: '50%',
        background: 'var(--auth-card-bg-alt)',
        border: '1px solid var(--auth-card-border-strong)',
        color: 'var(--auth-muted)',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      {initials(application.full_name)}
    </div>
  );
}

export default function ApplicationsList({ applications }) {
  const [activeTab, setActiveTab] = useState('new');
  const visible = filterSubmissionRowsByStatus(applications, activeTab);
  const activeLabel = activeTab.toLowerCase();

  return (
    <>
      <SubmissionTabs type="applications" rows={applications} activeTab={activeTab} onChange={setActiveTab} />

      {/* List */}
      {visible.length === 0 ? (
        <div
          className="rounded-[14px] p-12 text-center border"
          style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
        >
          <p style={{ color: 'var(--auth-muted)' }}>
            No {activeLabel} applications.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((a) => (
            <Link
              key={a.id}
              href={`/bananas/applications/${a.id}`}
              className="block rounded-[14px] p-6 border transition-colors hover:border-white/20"
              style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  <Avatar application={a} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h3
                        className="text-[18px] font-bold"
                        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                      >
                        {a.full_name}
                      </h3>
                      {a.preferred_name && (
                        <span className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
                          ({a.preferred_name})
                        </span>
                      )}
                    </div>
                    <div
                      className="text-[13px] flex flex-wrap gap-x-4 gap-y-1"
                      style={{ color: 'var(--auth-muted)' }}
                    >
                      <span>{a.email}</span>
                      <span>{a.phone}</span>
                      <span>{a.social_handle}</span>
                    </div>
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div
                    className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full mb-2"
                    style={{
                      background: a.plan === 'cowork-party' ? 'var(--auth-accent)' : 'var(--auth-card-bg-alt)',
                      color: a.plan === 'cowork-party' ? 'var(--auth-accent-text)' : 'var(--auth-text)',
                      border: '1px solid var(--auth-card-border-strong)',
                    }}
                  >
                    {a.plan === 'cowork-party' ? 'COWORK + PARTY' : 'COWORK'}
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--auth-faint)' }}>
                    {formatDate(a.created_at)}
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
