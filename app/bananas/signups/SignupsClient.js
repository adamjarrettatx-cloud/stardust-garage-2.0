'use client';

import { useState } from 'react';
import DeleteSignupButton from './DeleteSignupButton';
import SignupStatusButton from '@/app/bananas/components/SignupStatusButton';
import SubmissionTabs from '@/app/bananas/components/SubmissionTabs';
import SubmissionStatusBadge from '@/app/bananas/components/SubmissionStatusBadge';
import { filterSubmissionRowsByStatus, normalizeSubmissionStatus } from '@/lib/submission-workflow';

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

export default function SignupsClient({ signups, csvHref }) {
  const [activeTab, setActiveTab] = useState('new');

  const total = signups.length;
  const emailCount = signups.filter((s) => s.contact_type === 'email').length;
  const phoneCount = signups.filter((s) => s.contact_type === 'phone').length;
  const newCount = signups.filter((s) => normalizeSubmissionStatus(s.status) === 'new').length;
  const visible = filterSubmissionRowsByStatus(signups, activeTab);
  const activeLabel = activeTab === 'reviewed' ? 'seen' : activeTab.toLowerCase();

  return (
    <>
      <div className="grid grid-cols-1 gap-4 mb-10 sm:grid-cols-3">
        <div className="rounded-[14px] p-6 border" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
          <div className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: 'var(--auth-muted)' }}>TOTAL</div>
          <div className="text-[32px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{total}</div>
        </div>
        <div className="rounded-[14px] p-6 border" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
          <div className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: 'var(--auth-muted)' }}>EMAILS</div>
          <div className="text-[32px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{emailCount}</div>
        </div>
        <div className="rounded-[14px] p-6 border" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
          <div className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: 'var(--auth-muted)' }}>PHONES</div>
          <div className="text-[32px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{phoneCount}</div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-[12px]" style={{ color: 'var(--auth-muted)' }}>
        <span>
          New signups awaiting explicit acknowledgement:{' '}
          <strong style={{ color: 'var(--auth-accent)' }}>{newCount}</strong>
        </span>
        {csvHref && (
          <a
            href={csvHref}
            download={`signups-${new Date().toISOString().split('T')[0]}.csv`}
            className="px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.14em] border transition-colors"
            style={{ borderColor: 'var(--auth-ghost-border)', color: 'var(--auth-ghost-text)' }}
          >
            DOWNLOAD CSV
          </a>
        )}
      </div>

      <SubmissionTabs type="signups" rows={signups} activeTab={activeTab} onChange={setActiveTab} />

      {total === 0 ? (
        <div
          className="rounded-[14px] p-12 text-center border"
          style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
        >
          <p style={{ color: 'var(--auth-muted)' }}>No signups yet. They&apos;ll appear here as people sign up.</p>
        </div>
      ) : visible.length === 0 ? (
        <div
          className="rounded-[14px] p-12 text-center border"
          style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
        >
          <p style={{ color: 'var(--auth-muted)' }}>No {activeLabel} signups.</p>
        </div>
      ) : (
        <div className="rounded-[14px] border overflow-hidden" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--auth-row-border)' }}>
                  <th className="text-left px-6 py-4 text-[11px] font-semibold tracking-[0.14em]" style={{ color: 'var(--auth-muted)' }}>CONTACT</th>
                  <th className="text-left px-6 py-4 text-[11px] font-semibold tracking-[0.14em]" style={{ color: 'var(--auth-muted)' }}>TYPE</th>
                  <th className="text-left px-6 py-4 text-[11px] font-semibold tracking-[0.14em]" style={{ color: 'var(--auth-muted)' }}>STATUS</th>
                  <th className="text-left px-6 py-4 text-[11px] font-semibold tracking-[0.14em]" style={{ color: 'var(--auth-muted)' }}>WHEN</th>
                  <th className="text-right px-6 py-4 text-[11px] font-semibold tracking-[0.14em]" style={{ color: 'var(--auth-muted)' }}></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((signup) => (
                  <tr key={signup.id} style={{ borderBottom: '1px solid var(--auth-row-border)' }}>
                    <td className="px-6 py-4 text-[14px] font-medium">{signup.contact}</td>
                    <td className="px-6 py-4 text-[13px]" style={{ color: 'var(--auth-muted)' }}>{signup.contact_type || '—'}</td>
                    <td className="px-6 py-4 text-[13px]">
                      <SubmissionStatusBadge status={signup.status || 'new'} />
                    </td>
                    <td className="px-6 py-4 text-[13px]" style={{ color: 'var(--auth-muted)' }}>{formatDate(signup.created_at)}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <SignupStatusButton signupId={signup.id} currentStatus={signup.status || 'new'} />
                        <DeleteSignupButton signupId={signup.id} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
