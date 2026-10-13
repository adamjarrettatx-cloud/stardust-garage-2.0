'use client';

import { useState } from 'react';
import Link from 'next/link';
import SubmissionTabs from '@/app/bananas/components/SubmissionTabs';
import { filterSubmissionRowsByStatus } from '@/lib/submission-workflow';
import cardStyles from './applications.module.css';
import styles from '../components/profile-list.module.css';
import ApplicationAgeReview from './ApplicationAgeReview';
import { formatPhone } from '@/lib/phone';

function initials(name) {
  return (name || '').trim().split(/\s+/).slice(0, 2)
    .map((word) => word[0]?.toUpperCase() || '').join('') || '?';
}

function ApplicationPhoto({ application }) {
  const [failedUrl, setFailedUrl] = useState(null);
  // Keep server-signed private photos ahead of legacy public photo URLs.
  const src = application.display_photo_url || application.photo_url;
  return (
    <div className={styles.photo} style={{ aspectRatio: '1 / 1' }}>
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

export default function ApplicationsList({ applications }) {
  const [activeTab, setActiveTab] = useState('new');
  const visible = filterSubmissionRowsByStatus(applications, activeTab);

  return (
    <div className={cardStyles.layout}>
      <SubmissionTabs type="applications" rows={applications} activeTab={activeTab} onChange={setActiveTab} exactCounts />

      {visible.length === 0 ? (
        <div className={cardStyles.empty}>No {activeTab} applications.</div>
      ) : (
        <ul className={styles.list} data-testid="applications-list">
          {visible.map((a) => {
            const date = dateParts(a.created_at);
            const plan = a.plan === 'weekender' ? 'WEEKENDER'
              : a.plan === 'cowork-party' ? 'EXPERIENCE' : 'COWORK';
            return (
              <li key={a.id}>
                <Link
                  href={`/bananas/applications/${a.id}`}
                  className={styles.row}
                  aria-label={`View application for ${a.full_name}`}
                >
                  <ApplicationPhoto application={a} />
                  <div className={styles.identity}>
                    <div className={styles.stage}>{plan}</div>
                    <h2>{a.full_name}</h2>
                    {a.preferred_name ? <p className={styles.preferred}>Goes by {a.preferred_name}</p> : null}
                    <ApplicationAgeReview review={a.age_review} compact />
                  </div>
                  <dl className={styles.details}>
                    <div><dt>Email</dt><dd>{a.email || 'Not provided'}</dd></div>
                    <div><dt>Phone</dt><dd>{formatPhone(a.phone) || 'Not provided'}</dd></div>
                    <div><dt>Social</dt><dd>{a.social_handle || 'Not provided'}</dd></div>
                  </dl>
                  <div className={styles.action}>
                    <div className={styles.date}>
                      <span>Applied</span>
                      <time dateTime={a.created_at}>{date.day} · {date.time}</time>
                    </div>
                    <span className={styles.open}>
                      View application <span aria-hidden="true">↗</span>
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
