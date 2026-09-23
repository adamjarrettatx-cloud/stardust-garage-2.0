'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  CONTACT_DIRECTORY_SECTIONS, CONTACT_STATUS_OPTIONS, contactDirectorySection,
  contactDirectoryHref, filterDirectoryContacts, filterArchivedContacts,
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

function ArchivedContactsLink({ category }) {
  return <Link className={styles.archiveLink} href={contactDirectoryHref(category, true)}>Archived Contacts</Link>;
}

function ContactRows({ contacts, category, archived = false }) {
  return <div className={styles.rows}>
    {contacts.map(contact => <Link key={contact.id} className={styles.row}
      href={`/bananas/contacts/${contact.id}${archived ? `?view=archived${category ? `&category=${category}` : ''}` : `?category=${category}`}`}
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
  </div>;
}

function SectionList({ contacts, section }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const visible = useMemo(() => filterDirectoryContacts(contacts, section.value, query, status), [contacts, section.value, query, status]);
  const total = filterDirectoryContacts(contacts, section.value).length;
  return <>
    <Link href="/bananas/contacts" className={styles.back}><span aria-hidden="true">←</span> Contacts</Link>
    <div className={styles.heading}><h1>{section.label}</h1><NewContactLink category={section.value} /></div>
    <div className={styles.tools}>
      <input type="search" aria-label={`Search ${section.label} contacts`} placeholder="Search name, company, email, phone…"
        value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label="Filter by status" value={status} onChange={event => setStatus(event.target.value)}>
        <option value="">All statuses</option>
        {CONTACT_STATUS_OPTIONS.filter(option => option.value !== 'archived').map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
    </div>
    <div className={styles.listMeta}><p className={styles.count} role="status">{visible.length} {visible.length === 1 ? 'contact' : 'contacts'}</p><ArchivedContactsLink category={section.value} /></div>
    {visible.length === 0 ? <div className={styles.empty}>
      {total === 0 ? `No ${section.label.toLowerCase()} contacts yet.` : 'No contacts match this search and status.'}
    </div> : <ContactRows contacts={visible} category={section.value} />}
  </>;
}

function ArchivedList({ contacts, section }) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => filterArchivedContacts(contacts, section?.value, query), [contacts, section?.value, query]);
  return <>
    <Link href={contactDirectoryHref(section?.value)} className={styles.back}><span aria-hidden="true">←</span> {section?.label || 'Contacts'}</Link>
    <div className={styles.heading}><h1>Archived Contacts</h1></div>
    <p className={styles.description}>Archived {section ? `${section.label.toLowerCase()} ` : ''}contacts remain on file with their linked records and history. Open a profile to restore it.</p>
    <div className={styles.tools}><input type="search" aria-label="Search archived contacts"
      placeholder="Search name, company, email, phone…" value={query} onChange={event => setQuery(event.target.value)} /></div>
    <p className={styles.count} role="status">{visible.length} {visible.length === 1 ? 'archived contact' : 'archived contacts'}</p>
    {visible.length ? <ContactRows contacts={visible} category={section?.value} archived />
      : <div className={styles.empty}>{query ? 'No archived contacts match this search.' : 'No archived contacts.'}</div>}
  </>;
}

export default function ContactsList({ contacts }) {
  const searchParams = useSearchParams();
  const section = contactDirectorySection(searchParams?.get('category'));
  if (searchParams?.get('view') === 'archived') return <ArchivedList key={section?.value || 'all-archived'} contacts={contacts} section={section} />;
  if (section) return <SectionList key={section.value} contacts={contacts} section={section} />;
  return <>
    <div className={styles.heading}><h1>Contacts</h1><NewContactLink /></div>
    <p className={styles.description}>Choose a section to view and manage contacts.</p>
    <div className={styles.categories}>
      {CONTACT_DIRECTORY_SECTIONS.map(({ value, label, description }) => {
        const count = filterDirectoryContacts(contacts, value).length;
        return <Link key={value} href={contactDirectoryHref(value)} className={styles.category}>
          <div className={styles.categoryTop}><span>{count} {count === 1 ? 'contact' : 'contacts'}</span><span aria-hidden="true">↗</span></div>
          <h2>{label}</h2><p>{description}</p>
        </Link>;
      })}
    </div>
    <div className={styles.directoryFooter}><p className={styles.note}>A contact can appear in more than one section.</p><ArchivedContactsLink /></div>
  </>;
}
