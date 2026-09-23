'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  CONTACT_DIRECTORY_SECTIONS, CONTACT_STATUS_OPTIONS, contactDirectorySection,
  contactDirectoryHref, contactMatchesDirectorySection, filterDirectoryContacts,
} from '@/lib/contact-helpers';
import styles from './contacts.module.css';

function ContactImage({ contact }) {
  const [failed, setFailed] = useState(false);
  if (contact.photo_url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={contact.photo_url} alt="" className={styles.image} onError={() => setFailed(true)} />;
  }
  const initials = (contact.display_name || '').trim().split(/\s+/).slice(0, 2)
    .map(word => word[0]?.toUpperCase() || '').join('') || '?';
  return <span className={styles.image} aria-hidden="true">{initials}</span>;
}

function NewContactLink({ category }) {
  return <Link className={styles.add} href={category ? `/bananas/contacts/new?category=${category}` : '/bananas/contacts/new'}>+ NEW CONTACT</Link>;
}

function SectionList({ contacts, section }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const visible = useMemo(() => filterDirectoryContacts(contacts, section.value, query, status), [contacts, section.value, query, status]);
  const total = contacts.filter(contact => contactMatchesDirectorySection(contact.contact_type, section.value)).length;
  return <>
    <Link href="/bananas/contacts" className={styles.back}><span aria-hidden="true">←</span> Contacts</Link>
    <div className={styles.heading}><h1>{section.label}</h1><NewContactLink category={section.value} /></div>
    <div className={styles.tools}>
      <input type="search" aria-label={`Search ${section.label} contacts`} placeholder="Search name, company, email, phone…"
        value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label="Filter by status" value={status} onChange={event => setStatus(event.target.value)}>
        <option value="">All statuses</option>
        {CONTACT_STATUS_OPTIONS.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
    </div>
    <p className={styles.count} role="status">{visible.length} {visible.length === 1 ? 'contact' : 'contacts'}</p>
    {visible.length === 0 ? <div className={styles.empty}>
      {total === 0 ? `No ${section.label.toLowerCase()} contacts yet.` : 'No contacts match this search and status.'}
    </div> : <div className={styles.rows}>
      {visible.map(contact => <Link key={contact.id} className={styles.row}
        href={`/bananas/contacts/${contact.id}?category=${section.value}`}
        style={contact.status === 'do_not_book' ? { borderColor: 'var(--auth-danger-border)' } : undefined}>
        <ContactImage key={`${contact.id}:${contact.photo_url}`} contact={contact} />
        <div className={styles.info}>
          <div className={styles.nameLine}><h2 title={contact.display_name}>{contact.display_name}</h2>
            {contact.primary_contact_name && <span className={styles.primary}>{contact.primary_contact_name}</span>}
            {contact.status === 'do_not_book' && <span className={styles.warning}>Do Not Book</span>}
          </div>
          {contact.company && <div className={styles.company}>{contact.company}</div>}
          <div className={styles.details}>
            {contact.email && <span title={contact.email}>{contact.email}</span>}
            {contact.phone && <span>{contact.phone}</span>}
            {contact.instagram_handle && <span className={styles.instagram}>{contact.instagram_handle}</span>}
          </div>
        </div>
        <span className={styles.arrow} aria-hidden="true">›</span>
      </Link>)}
    </div>}
  </>;
}

export default function ContactsList({ contacts }) {
  const searchParams = useSearchParams();
  const section = contactDirectorySection(searchParams?.get('category'));
  if (section) return <SectionList key={section.value} contacts={contacts} section={section} />;
  return <>
    <div className={styles.heading}><h1>Contacts</h1><NewContactLink /></div>
    <p className={styles.description}>Choose a section to view and manage contacts.</p>
    <div className={styles.categories}>
      {CONTACT_DIRECTORY_SECTIONS.map(({ value, label, description }) => {
        const count = contacts.filter(contact => contactMatchesDirectorySection(contact.contact_type, value)).length;
        return <Link key={value} href={contactDirectoryHref(value)} className={styles.category}>
          <div className={styles.categoryTop}><span>{count} {count === 1 ? 'contact' : 'contacts'}</span><span aria-hidden="true">↗</span></div>
          <h2>{label}</h2><p>{description}</p>
        </Link>;
      })}
    </div>
    <p className={styles.note}>A contact can appear in more than one section.</p>
  </>;
}
