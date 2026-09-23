'use client';

import { useState } from 'react';
import Link from 'next/link';
import SubmissionTabs from '@/app/bananas/components/SubmissionTabs';
import { filterSubmissionRowsByStatus } from '@/lib/submission-workflow';
import styles from './applications.module.css';

function initials(name) {
  return (name || '').trim().split(/\s+/).slice(0, 2)
    .map((word) => word[0]?.toUpperCase() || '').join('') || '?';
}

function ApplicationPhoto({ application }) {
  const [failedUrl, setFailedUrl] = useState(null);
  // Keep server-signed private photos ahead of legacy public photo URLs.
  const src = application.display_photo_url || application.photo_url;
  return (
    <div className={styles.photo}>
      {src && src !== failedUrl ? (
        // Signed private URLs are resolved by the server, not Next's optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={application.full_name}
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(src)}
        />
      ) : (
        <span aria-hidden="true">{initials(application.full_name)}</span>
      )}
    </div>
  );
}

function dateParts(value) {
  const date = new Date(value);
  return {
    day: date.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago',
    }),
    time: date.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago',
    }),
  };
}

function formatPhone(value) {
  const digits = (value || '').replace(/\D/g, '');
  const domestic = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
  return domestic.length === 10
    ? `(${domestic.slice(0, 3)}) ${domestic.slice(3, 6)}-${domestic.slice(6)}`
    : value;
}

export default function ApplicationsList({ applications }) {
  const [activeTab, setActiveTab] = useState('new');
  const visible = filterSubmissionRowsByStatus(applications, activeTab);

  return (
    <div className={styles.layout}>
      <SubmissionTabs type="applications" rows={applications} activeTab={activeTab} onChange={setActiveTab} />

      {visible.length === 0 ? (
        <div className={styles.empty}>No {activeTab} applications.</div>
      ) : (
        <div className={styles.grid}>
          {visible.map((a) => {
            const date = dateParts(a.created_at);
            const plan = a.plan === 'weekender' ? 'WEEKENDER'
              : a.plan === 'cowork-party' ? 'EXPERIENCE' : 'COWORK';
            return (
              <Link
                key={a.id}
                href={`/bananas/applications/${a.id}`}
                className={styles.card}
                aria-label={`View application for ${a.full_name}`}
              >
                <ApplicationPhoto application={a} />
                <div className={styles.body}>
                  <div className={styles.identity}>
                    <div className={styles.plan}>{plan}</div>
                    <h2>{a.full_name}</h2>
                    <p className={styles.preferred}>
                      {a.preferred_name ? `Goes by ${a.preferred_name}` : '\u00A0'}
                    </p>
                  </div>
                  <dl className={styles.details}>
                    <div><dt>Email</dt><dd>{a.email || 'Not provided'}</dd></div>
                    <div><dt>Phone</dt><dd>{formatPhone(a.phone) || 'Not provided'}</dd></div>
                    <div><dt>Social</dt><dd>{a.social_handle || 'Not provided'}</dd></div>
                  </dl>
                </div>
                <div className={styles.footer}>
                  <div className={styles.date}>
                    <span>Applied</span>
                    <time dateTime={a.created_at}>{date.day}<br />{date.time}</time>
                  </div>
                  <span className={styles.open}>
                    View application <span aria-hidden="true">↗</span>
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
