'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import styles from './profile.module.css';

// Read-only list of organizations this person is linked to. Links are managed
// from each organization's profile.
export default function PersonOrganizations({ contactId }) {
  const uid = useId();
  const [organizations, setOrganizations] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/contacts/${contactId}/organizations`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load organizations.');
        setOrganizations(data.organizations);
      })
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, [contactId]);
  if (!error && organizations && organizations.length === 0) return null;
  return <section className={`${styles.card} ${styles.organizationContact}`} aria-labelledby={`${uid}-heading`}>
    <div className={styles.cardHeading}><h2 id={`${uid}-heading`}>Organizations</h2><span>Linked</span></div>
    <div className={styles.cardBody}>
      {!organizations && !error && <p role="status">Loading organizations…</p>}
      {error && <div role="alert" className={styles.error}>{error}</div>}
      {organizations && organizations.length > 0 && <ul className={styles.peopleList}>{organizations.map((org) => <li key={org.id} className={styles.peopleItem}>
        <div className={styles.peopleText}>
          <h3>{org.name}</h3>
          <p>{[org.main_contact && 'Main point of contact', org.role].filter(Boolean).join(' · ') || 'Associated person'}{org.status !== 'active' ? ` · ${org.status === 'do_not_book' ? 'Do Not Book' : org.status}` : ''}</p>
        </div>
        <div className={styles.peopleActions}><Link className={styles.textButton} href={`/bananas/contacts/${org.id}`}>Open organization →</Link></div>
      </li>)}</ul>}
    </div>
  </section>;
}
