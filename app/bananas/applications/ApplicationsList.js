'use client';

import { useState } from 'react';
import Link from 'next/link';
import SubmissionTabs from '@/app/bananas/components/SubmissionTabs';
import { filterSubmissionRowsByStatus } from '@/lib/submission-workflow';
import styles from './applications.module.css';

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
  const [failedUrl, setFailedUrl] = useState(null);
  // Prefer the server-resolved display_photo_url (signed URL from the private
  // profile-photos bucket when profile_photo_path is set) over the raw
  // legacy photo_url. See lib/member-photo.js.
  const src = application.display_photo_url || application.photo_url;
  if (src && src !== failedUrl) {
    return (
      // Signed private URLs are resolved by the server, not Next's image optimizer.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={application.full_name}
        className={styles.photo}
        onError={() => setFailedUrl(src)}
      />
    );
  }
  return (
    <div
      className={styles.photo}
      aria-hidden="true"
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
              className={`${styles.card} rounded-[14px] border transition-colors hover:border-white/20`}
              style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
            >
              <Avatar application={a} />
              <div className={styles.content}>
                <div className="flex items-start flex-1 min-w-0">
                  <div className="flex-1 min-w-0">
                    <div className={styles.nameLine}>
                      <h3
                        className="text-[18px] font-bold truncate"
                        title={a.full_name}
                        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                      >
                        {a.full_name}
                      </h3>
                      {a.preferred_name && (
                        <span className="text-[13px] truncate" title={a.preferred_name} style={{ color: 'var(--auth-muted)' }}>
                          ({a.preferred_name})
                        </span>
                      )}
                    </div>
                    <div
                      className={`${styles.details} text-[13px]`}
                      style={{ color: 'var(--auth-muted)' }}
                    >
                      <span title={a.email}>{a.email}</span>
                      <span title={a.phone}>{a.phone}</span>
                      <span title={a.social_handle}>{a.social_handle}</span>
                    </div>
                  </div>
                </div>
                <div className={styles.metadata}>
                  <div
                    className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full mb-2"
                    style={{
                      background: a.plan === 'cowork-party' ? 'var(--auth-accent)' : 'var(--auth-card-bg-alt)',
                      color: a.plan === 'cowork-party' ? 'var(--auth-accent-text)' : 'var(--auth-text)',
                      // 'cowork-party' renders as "EXPERIENCE"; new 'weekender' plan gets its own label.
                      border: '1px solid var(--auth-card-border-strong)',
                    }}
                  >
                    {a.plan === 'cowork-party' ? 'EXPERIENCE' : a.plan === 'weekender' ? 'WEEKENDER' : 'COWORK'}
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
