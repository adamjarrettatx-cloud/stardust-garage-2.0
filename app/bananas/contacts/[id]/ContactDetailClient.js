'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { formatMoney } from '@/lib/studio-helpers';
import { contactStatusLabel, isContractorContact, contactDirectorySection } from '@/lib/contact-helpers';
import { defaultSignerEmail, isEventOrganizer, organizerDisplayLabel } from '@/lib/event-organizer';
import ContactForm from '../ContactForm';
import InvitePartnerButton from './InvitePartnerButton';
import TaxProfileSection from './TaxProfileSection';
import PayoutProfileSection from './PayoutProfileSection';
import styles from '../profile.module.css';

const KIND_LABELS = {
  event: 'Event', contract: 'Contract', venue_inquiry: 'Venue inquiry',
  collaboration: 'Collaboration', micro_party: 'Micro party',
};
const FIELD_LABELS = {
  display_name: 'Display name', contact_type: 'Relationship type',
  primary_contact_name: 'Primary contact', email: 'Email', phone: 'Phone', company: 'Company',
  instagram_handle: 'Instagram', website: 'Website', status: 'Status',
  internal_notes: 'Internal notes', additional_contacts: 'Additional contacts', photo_url: 'Photo URL',
};
const ACTION_LABELS = {
  create: 'Created', update: 'Updated', status_change: 'Status changed', note_added: 'Note added',
  link_added: 'Link added', link_removed: 'Link removed', delete_attempted: 'Delete attempted',
};

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
function formatDay(value) {
  if (!value) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function auditValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.map((v) => typeof v === 'object' ? JSON.stringify(v) : v).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  const str = String(value);
  return str.length > 120 ? `${str.slice(0, 120)}…` : str;
}
function auditLines(row) {
  const data = row.details;
  if (!data) return [];
  if (data.note) return [data.note];
  if (row.action === 'update' && data.changed) {
    return Object.entries(data.changed).map(([field, change]) =>
      `${FIELD_LABELS[field] || field}: ${auditValue(change?.from)} → ${auditValue(change?.to)}`);
  }
  if (row.action === 'status_change') return [`${contactStatusLabel(data.from)} → ${contactStatusLabel(data.to)}`];
  if (row.action === 'create') return [`${data.display_name || ''} · ${auditValue(data.contact_type)}`.trim()];
  return [auditValue(data)];
}

export default function ContactDetailClient({
  contact: initialContact, isAdmin, isOwner = false, partnerProfile, taxProfile: initialTaxProfile,
  events, contracts, venueInquiries, collaborations, microParties, audit,
}) {
  const searchParams = useSearchParams();
  const category = contactDirectorySection(searchParams?.get('category'))?.value || null;
  const [contact, setContact] = useState(initialContact);
  const [taxProfile, setTaxProfile] = useState(initialTaxProfile);
  const [historyView, setHistoryView] = useState(false);
  useEffect(() => { setContact(initialContact); }, [initialContact]);
  useEffect(() => { setTaxProfile(initialTaxProfile); }, [initialTaxProfile]);
  const isContractor = isContractorContact(contact.contact_type);
  const isOrganizer = isEventOrganizer(contact);
  const organizerGaps = useMemo(() => {
    if (!isOrganizer) return [];
    const gaps = [];
    if (!defaultSignerEmail(contact)) gaps.push('a signer email');
    if (!contact.legal_name) gaps.push('a legal name');
    if (!contact.entity_type) gaps.push('an entity type');
    if (!contact.address_line1 || !contact.address_city || !contact.address_state) gaps.push('a mailing address for notices');
    return gaps;
  }, [isOrganizer, contact]);
  const timeline = useMemo(() => [
    ...events.map((event) => ({
      key: `event-${event.id}`, kind: 'event', title: event.title, date: event.event_date,
      href: `/bananas/events/${event.id}`, meta: [event.status?.toUpperCase(), event.slug ? `/events/${event.slug}` : null],
    })),
    ...contracts.map((contract) => ({
      key: `contract-${contract.id}`, kind: 'contract', title: contract.counterparty_name || 'Contract',
      date: contract.created_at, href: contract.document_id ? `/bananas/documents/${contract.document_id}` : null,
      meta: [contract.status?.toUpperCase(), contract.flat_fee_cents != null ? `${formatMoney(contract.flat_fee_cents)} flat fee` : null],
    })),
    ...venueInquiries.map((inquiry) => ({
      key: `venue-${inquiry.id}`, kind: 'venue_inquiry', title: inquiry.full_name, date: inquiry.created_at,
      href: `/bananas/venue-inquiries/${inquiry.id}`, meta: [inquiry.status?.toUpperCase(), inquiry.event_type, inquiry.preferred_dates],
    })),
    ...collaborations.map((collaboration) => ({
      key: `collab-${collaboration.id}`, kind: 'collaboration', title: collaboration.full_name, date: collaboration.created_at,
      href: `/bananas/collaborations/${collaboration.id}`, meta: [collaboration.status?.toUpperCase(), collaboration.collaborator_type],
    })),
    ...microParties.map((party) => ({
      key: `micro-${party.id}`, kind: 'micro_party', title: party.event_name || party.full_name, date: party.event_date || party.created_at,
      href: `/bananas/micro-parties/${party.id}`, meta: [party.status?.toUpperCase(), party.full_name],
    })),
  ].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
  [events, contracts, venueInquiries, collaborations, microParties]);

  const w9Missing = isAdmin && isContractor && !taxProfile?.w9_on_file;
  const legalSummary = isOrganizer ? (
    <div className={`${styles.banner} ${organizerGaps.length ? styles.bannerWarning : ''}`}>
      {contact.status === 'archived' ? <>
        <strong>Archived contact.</strong> Restore this contact before sending a new agreement. Existing agreements and history remain on file.
      </> : organizerGaps.length ? <>
        <strong>Not yet contract-ready.</strong> Still needs {organizerGaps.join(', ')}. Complete the details below before sending an agreement.
      </> : <>
        <strong>Ready for contracts.</strong> Agreements will be issued to {organizerDisplayLabel(contact)} and sent to {defaultSignerEmail(contact)}. Start a contract from the event this organizer is attached to.
      </>}
    </div>
  ) : null;
  const taxPanel = (isAdmin && isContractor) || isOwner ? (
    <>
      {w9Missing && <div className={`${styles.banner} ${styles.bannerWarning}`}>
        <strong>W-9 required for year-end reporting.</strong> A signed W-9 is needed to issue this contractor’s 1099. It is not required to approve or send a pay request.
      </div>}
      {isAdmin && isContractor && <TaxProfileSection contactId={contact.id} displayName={contact.display_name} taxProfile={taxProfile} onChange={setTaxProfile} />}
      {isOwner && <PayoutProfileSection contactId={contact.id} displayName={contact.display_name} />}
    </>
  ) : null;
  const activityPanel = (
    <>
      <div className={styles.activityTabs} aria-label="Activity type">
        <button type="button" className={styles.button} aria-pressed={!historyView} onClick={() => setHistoryView(false)}>Linked activity ({timeline.length})</button>
        <button type="button" className={styles.button} aria-pressed={historyView} onClick={() => setHistoryView(true)}>Edit history ({audit.length})</button>
      </div>
      <section className={styles.card}>
        <div className={styles.cardHeading}><h2>{historyView ? 'Edit history' : 'Linked activity'}</h2></div>
        <div className={styles.cardBody}>
          {!historyView && (timeline.length ? <div className={styles.activityRows}>{timeline.map((item) => {
            const meta = (item.meta || []).filter(Boolean).join(' · ');
            const body = <><span className={styles.activityKind}>{KIND_LABELS[item.kind]}</span><div className={styles.activityTitle}><strong>{item.title}</strong>{meta && <p>{meta}</p>}</div><time className={styles.activityDate}>{formatDay(item.date)}</time></>;
            return item.href ? <Link key={item.key} href={item.href} className={styles.activityRow}>{body}</Link> : <div key={item.key} className={styles.activityRow}>{body}</div>;
          })}</div> : <p className={styles.empty}>Nothing linked yet. Events, contracts and inquiries appear here when attached to this contact.</p>)}
          {historyView && (audit.length ? <div className={styles.activityRows}>{audit.map((row) => <div key={row.id} className={styles.auditItem}>
            <div className={styles.auditHeading}><strong>{ACTION_LABELS[row.action] || row.action}</strong><span>{row.actor_email || '—'}</span><span>{formatDateTime(row.created_at)}</span></div>
            {auditLines(row).map((line, index) => <p key={index} className={styles.auditLine}>{line}</p>)}
          </div>)}</div> : <p className={styles.empty}>No changes recorded yet.</p>)}
        </div>
      </section>
    </>
  );
  return (
    <ContactForm key={contact.id} contact={contact} initialCategory={category} profile={{
      onSaved: setContact, isOrganizer, organizerGaps, w9Missing, showTaxStatus: isAdmin && isContractor,
      createdLabel: formatDay(contact.created_at), updatedLabel: formatDay(contact.updated_at),
      canArchive: isAdmin,
      archivedView: searchParams?.get('view') === 'archived',
      portalStatus: partnerProfile ? (partnerProfile.is_active ? 'Portal profile active.' : 'Invited. Pending activation.') : 'No portal invitation on file.',
      portalPanel: isAdmin ? <InvitePartnerButton contactId={contact.id} email={contact.email} contactType={contact.contact_type} partnerProfile={partnerProfile} isContractor={isContractor} /> : null,
      legalSummary, taxPanel, activityPanel,
    }} />
  );
}
