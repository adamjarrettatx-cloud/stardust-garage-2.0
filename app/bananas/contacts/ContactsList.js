'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CONTACT_DIRECTORY_SECTIONS, CONTACT_STATUS_OPTIONS, contactDirectorySection,
  contactDirectoryHref, filterDirectoryContacts, filterArchivedContacts, contactDirectoryTypes,
} from '@/lib/contact-helpers';
import UnderlineTabs from '../components/UnderlineTabs';
import styles from './contacts.module.css';

// The directory opens straight onto a list. There is no separate category
// dashboard and no All tab: the four sections are tabs with live counts, and a
// bare /bananas/contacts URL lands on the first section (Persons).
const DEFAULT_SECTION = CONTACT_DIRECTORY_SECTIONS[0];
const TYPE_LABELS = { person: 'Person', organization: 'Organization', venue_renter: 'Venue Renter', vendor: 'Vendor' };

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

// Stored handles arrive as @name, bare names or full profile URLs.
function instagramHandle(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const fromUrl = raw.match(/instagram\.com\/([^/?#]+)/i);
  const handle = (fromUrl ? fromUrl[1] : raw).replace(/^@/, '');
  return handle ? `@${handle}` : '';
}

// Secondary line: the legacy point-of-contact name and company, skipping
// values that only repeat the display name ("Adam" under "Adam Jarrett").
function contactSubline(contact) {
  const name = String(contact.display_name || '').toLowerCase();
  const adds = value => value && !name.includes(String(value).trim().toLowerCase());
  return [contact.primary_contact_name, contact.company].filter(adds).join(' · ');
}

function NewContactLink({ category }) {
  return <Link className={styles.add} href={category ? `/bananas/contacts/new?category=${category}` : '/bananas/contacts/new'}>{category === 'organization' ? '+ NEW ORGANIZATION' : '+ NEW CONTACT'}</Link>;
}

function ArchivedContactsLink({ category }) {
  return <Link className={styles.archiveLink} href={contactDirectoryHref(category, true)}>Archived Contacts</Link>;
}

function SearchInput({ label, value, onChange }) {
  const ref = useRef(null);
  // "/" jumps to search, matching common directory tools.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
      event.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return <label className={styles.search}>
    <svg aria-hidden="true" viewBox="0 0 20 20" width="15" height="15"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M13.5 13.5 17 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
    <input ref={ref} type="search" aria-label={label} placeholder="Search name, email, phone…"
      value={value} onChange={event => onChange(event.target.value)} />
    {!value && <kbd aria-hidden="true">/</kbd>}
  </label>;
}

function ContactRows({ contacts, category, archived = false }) {
  return <div className={styles.table} role="list">
    <div className={styles.tableHead} aria-hidden="true">
      <span>Name</span><span>Type</span><span>Email</span><span>Phone</span><span>Instagram</span><span />
    </div>
    {contacts.map(contact => {
      const sub = contactSubline(contact);
      const handle = instagramHandle(contact.instagram_handle);
      const blocked = contact.status === 'do_not_book';
      return <Link key={contact.id} role="listitem" className={`${styles.row} ${blocked ? styles.rowBlocked : ''}`}
        href={`/bananas/contacts/${contact.id}${archived ? `?view=archived${category ? `&category=${category}` : ''}` : `?category=${category}`}`}>
        <div className={styles.nameCell}>
          <ContactImage key={`${contact.id}:${contact.photo_url}`} contact={contact} />
          <div className={styles.nameText}>
            <div className={styles.nameLine}>
              <h2 title={contact.display_name}>{contact.display_name}</h2>
              {blocked && <span className={styles.warning}>Do Not Book</span>}
            </div>
            {sub && <div className={styles.sub} title={sub}>{sub}</div>}
            <div className={styles.mobileMeta}>{contact.email || contact.phone || handle}</div>
          </div>
        </div>
        <div className={styles.types}>
          {contactDirectoryTypes(contact.contact_type).map(type => <span key={type} className={styles.tag}>{TYPE_LABELS[type]}</span>)}
        </div>
        <span className={styles.cell} title={contact.email || undefined}>{contact.email || <span className={styles.none}>—</span>}</span>
        <span className={`${styles.cell} ${styles.num}`}>{contact.phone || <span className={styles.none}>—</span>}</span>
        <span className={`${styles.cell} ${styles.instagram}`} title={handle || undefined}>{handle || <span className={styles.none}>—</span>}</span>
        <span className={styles.arrow} aria-hidden="true">›</span>
      </Link>;
    })}
  </div>;
}

function Directory({ contacts, section }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const visible = useMemo(() => filterDirectoryContacts(contacts, section.value, query, status), [contacts, section.value, query, status]);
  const total = filterDirectoryContacts(contacts, section.value).length;
  const tabs = CONTACT_DIRECTORY_SECTIONS.map(({ value, label }) => ({ id: value, label, count: filterDirectoryContacts(contacts, value).length }));
  return <>
    <div className={styles.heading}>
      <h1>Contacts</h1>
      <div className={styles.headingActions}><ArchivedContactsLink category={section.value} /><NewContactLink category={section.value} /></div>
    </div>
    <div className={styles.tabs}>
      <UnderlineTabs ariaLabel="Contact sections" tabs={tabs} active={section.value}
        onChange={value => router.replace(contactDirectoryHref(value), { scroll: false })} />
    </div>
    <div className={styles.tools}>
      <SearchInput label={`Search ${section.label} contacts`} value={query} onChange={setQuery} />
      <select aria-label="Filter by status" value={status} onChange={event => setStatus(event.target.value)}>
        <option value="">All statuses</option>
        {CONTACT_STATUS_OPTIONS.filter(option => option.value !== 'archived').map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
      <p className={styles.count} role="status">{visible.length === total ? total : `${visible.length} of ${total}`} {total === 1 ? 'contact' : 'contacts'}</p>
    </div>
    {visible.length === 0 ? <div className={styles.empty}>
      {total === 0 ? <>No {section.label.toLowerCase()} contacts yet. <Link href={`/bananas/contacts/new?category=${section.value}`}>Add the first one</Link></> : 'No contacts match this search and status.'}
    </div> : <ContactRows contacts={visible} category={section.value} />}
    <div className={styles.footer}><p className={styles.note}>A contact can appear in more than one section.</p><ArchivedContactsLink category={section.value} /></div>
  </>;
}

function ArchivedList({ contacts, section }) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => filterArchivedContacts(contacts, section?.value, query), [contacts, section?.value, query]);
  return <>
    <Link href={contactDirectoryHref(section?.value)} className={styles.back}><span aria-hidden="true">←</span> {section?.label || 'Contacts'}</Link>
    <div className={styles.heading}><h1>Archived Contacts</h1></div>
    <p className={styles.description}>Archived {section ? `${section.label.toLowerCase()} ` : ''}contacts remain on file with their linked records and history. Open a profile to restore it.</p>
    <div className={styles.tools}>
      <SearchInput label="Search archived contacts" value={query} onChange={setQuery} />
      <p className={styles.count} role="status">{visible.length} {visible.length === 1 ? 'archived contact' : 'archived contacts'}</p>
    </div>
    {visible.length ? <ContactRows contacts={visible} category={section?.value} archived />
      : <div className={styles.empty}>{query ? 'No archived contacts match this search.' : 'No archived contacts.'}</div>}
  </>;
}

export default function ContactsList({ contacts }) {
  const searchParams = useSearchParams();
  const section = contactDirectorySection(searchParams?.get('category'));
  if (searchParams?.get('view') === 'archived') return <ArchivedList key={section?.value || 'all-archived'} contacts={contacts} section={section} />;
  const active = section || DEFAULT_SECTION;
  return <Directory key={active.value} contacts={contacts} section={active} />;
}
