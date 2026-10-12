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
import { formatPhone } from '@/lib/phone';

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

// Sortable columns. Missing values always sort last in either direction so a
// descending sort never opens on a wall of dashes.
const SORT_COLUMNS = [
  { key: 'name', label: 'Name', value: c => c.display_name },
  { key: 'type', label: 'Type', value: c => contactDirectoryTypes(c.contact_type).map(t => TYPE_LABELS[t]).join(' ') },
  { key: 'email', label: 'Email', value: c => c.email },
  { key: 'phone', label: 'Phone', value: c => String(c.phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '') },
  { key: 'instagram', label: 'Instagram', value: c => instagramHandle(c.instagram_handle).replace(/^@/, '') },
];
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export function sortContacts(contacts, sort) {
  const column = SORT_COLUMNS.find(col => col.key === sort?.key) || SORT_COLUMNS[0];
  const dir = sort?.dir === 'desc' ? -1 : 1;
  return [...contacts].sort((a, b) => {
    const av = String(column.value(a) || '').trim();
    const bv = String(column.value(b) || '').trim();
    if (!av !== !bv) return av ? -1 : 1;
    return (collator.compare(av, bv) * dir) || collator.compare(a.display_name || '', b.display_name || '');
  });
}

function SortHeader({ column, sort, onSort, className }) {
  const active = sort.key === column.key;
  const nextDir = active && sort.dir === 'asc' ? 'desc' : 'asc';
  return <span className={className}>
    <button type="button" className={`${styles.sortButton} ${active ? styles.sortActive : ''}`}
      onClick={() => onSort({ key: column.key, dir: nextDir })}
      aria-label={`${column.label}${active ? `, sorted ${sort.dir === 'asc' ? 'ascending' : 'descending'}` : ''}. Sort ${nextDir === 'asc' ? 'ascending' : 'descending'}`}
      title={`Sort by ${column.label.toLowerCase()} ${nextDir === 'asc' ? 'ascending' : 'descending'}`}>
      {column.label}
      <svg aria-hidden="true" viewBox="0 0 10 14" width="8" height="11" className={styles.sortIcon}>
        <path d="M5 1 9 5.5H1z" className={active && sort.dir === 'asc' ? styles.sortOn : ''} />
        <path d="M5 13 1 8.5h8z" className={active && sort.dir === 'desc' ? styles.sortOn : ''} />
      </svg>
    </button>
  </span>;
}

function SortSelect({ sort, onSort }) {
  return <select className={styles.sortSelect} aria-label="Sort contacts" value={`${sort.key}:${sort.dir}`}
    onChange={event => { const [key, dir] = event.target.value.split(':'); onSort({ key, dir }); }}>
    {SORT_COLUMNS.flatMap(col => [
      <option key={`${col.key}:asc`} value={`${col.key}:asc`}>{col.label} {col.key === 'phone' ? '0–9' : 'A–Z'}</option>,
      <option key={`${col.key}:desc`} value={`${col.key}:desc`}>{col.label} {col.key === 'phone' ? '9–0' : 'Z–A'}</option>,
    ])}
  </select>;
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

function ContactRows({ contacts, category, archived = false, sort, onSort }) {
  return <div className={styles.table} role="list">
    <div className={styles.tableHead}>
      {SORT_COLUMNS.map(column => <SortHeader key={column.key} column={column} sort={sort} onSort={onSort}
        className={column.key === 'instagram' ? styles.instagram : undefined} />)}
      <span aria-hidden="true" />
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
            <div className={styles.mobileMeta}>{contact.email || formatPhone(contact.phone) || handle}</div>
          </div>
        </div>
        <div className={styles.types}>
          {contactDirectoryTypes(contact.contact_type).map(type => <span key={type} className={styles.tag}>{TYPE_LABELS[type]}</span>)}
        </div>
        <span className={styles.cell} title={contact.email || undefined}>{contact.email || <span className={styles.none}>—</span>}</span>
        <span className={`${styles.cell} ${styles.num}`}>{formatPhone(contact.phone) || <span className={styles.none}>—</span>}</span>
        <span className={`${styles.cell} ${styles.instagram}`} title={handle || undefined}>{handle || <span className={styles.none}>—</span>}</span>
        <span className={styles.arrow} aria-hidden="true">›</span>
      </Link>;
    })}
  </div>;
}

function Directory({ contacts, section, sort, onSort }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const visible = useMemo(() => sortContacts(filterDirectoryContacts(contacts, section.value, query, status), sort), [contacts, section.value, query, status, sort]);
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
      <SortSelect sort={sort} onSort={onSort} />
      <p className={styles.count} role="status">{visible.length === total ? total : `${visible.length} of ${total}`} {total === 1 ? 'contact' : 'contacts'}</p>
    </div>
    {visible.length === 0 ? <div className={styles.empty}>
      {total === 0 ? <>No {section.label.toLowerCase()} contacts yet. <Link href={`/bananas/contacts/new?category=${section.value}`}>Add the first one</Link></> : 'No contacts match this search and status.'}
    </div> : <ContactRows contacts={visible} category={section.value} sort={sort} onSort={onSort} />}
    <div className={styles.footer}><p className={styles.note}>A contact can appear in more than one section.</p><ArchivedContactsLink category={section.value} /></div>
  </>;
}

function ArchivedList({ contacts, section, sort, onSort }) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => sortContacts(filterArchivedContacts(contacts, section?.value, query), sort), [contacts, section?.value, query, sort]);
  return <>
    <Link href={contactDirectoryHref(section?.value)} className={styles.back}><span aria-hidden="true">←</span> {section?.label || 'Contacts'}</Link>
    <div className={styles.heading}><h1>Archived Contacts</h1></div>
    <p className={styles.description}>Archived {section ? `${section.label.toLowerCase()} ` : ''}contacts remain on file with their linked records and history. Open a profile to restore it.</p>
    <div className={styles.tools}>
      <SearchInput label="Search archived contacts" value={query} onChange={setQuery} />
      <SortSelect sort={sort} onSort={onSort} />
      <p className={styles.count} role="status">{visible.length} {visible.length === 1 ? 'archived contact' : 'archived contacts'}</p>
    </div>
    {visible.length ? <ContactRows contacts={visible} category={section?.value} archived sort={sort} onSort={onSort} />
      : <div className={styles.empty}>{query ? 'No archived contacts match this search.' : 'No archived contacts.'}</div>}
  </>;
}

export default function ContactsList({ contacts }) {
  const searchParams = useSearchParams();
  // Sort lives above the keyed section views so it carries across tab changes.
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const section = contactDirectorySection(searchParams?.get('category'));
  if (searchParams?.get('view') === 'archived') return <ArchivedList key={section?.value || 'all-archived'} contacts={contacts} section={section} sort={sort} onSort={setSort} />;
  const active = section || DEFAULT_SECTION;
  return <Directory key={active.value} contacts={contacts} section={active} sort={sort} onSort={setSort} />;
}
