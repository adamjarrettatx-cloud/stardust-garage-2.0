'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { formatMoney } from '@/lib/studio-helpers';
import { contactStatusLabel, isContractorContact } from '@/lib/contact-helpers';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import ContactForm from '../ContactForm';
import { ContactStatusBadge, ContactTypeBadges } from '../ContactBadges';
import DeleteContactButton from './DeleteContactButton';
import InvitePartnerButton from './InvitePartnerButton';
import TaxProfileSection from './TaxProfileSection';

const KIND_LABELS = {
  event: 'EVENT',
  contract: 'CONTRACT',
  venue_inquiry: 'VENUE INQUIRY',
  collaboration: 'COLLABORATION',
  micro_party: 'MICRO PARTY',
};

const FIELD_LABELS = {
  display_name: 'Display name',
  contact_type: 'Relationship type',
  primary_contact_name: 'Primary contact',
  email: 'Email',
  phone: 'Phone',
  company: 'Company',
  instagram_handle: 'Instagram',
  website: 'Website',
  status: 'Status',
  internal_notes: 'Internal notes',
  additional_contacts: 'Additional contacts',
  photo_url: 'Photo URL',
};

const ACTION_LABELS = {
  create: 'Created',
  update: 'Updated',
  status_change: 'Status changed',
  note_added: 'Note added',
  link_added: 'Link added',
  link_removed: 'Link removed',
  delete_attempted: 'Delete attempted',
};

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDay(value) {
  if (!value) return '—';
  // Event dates are date-only columns; anchor them at midday so the local
  // timezone can't shift them onto the previous day.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function auditValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) {
    return value.length === 0
      ? '—'
      : value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : v)).join(', ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  const s = String(value);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

// Turn a stored audit `details` blob into the lines shown under the action.
function auditLines(row) {
  const d = row.details;
  if (!d) return [];

  // Actions that aren't a field diff (e.g. a partner invite) carry a plain note.
  if (d.note) return [d.note];
  if (row.action === 'update' && d.changed) {
    return Object.entries(d.changed).map(
      ([field, change]) =>
        `${FIELD_LABELS[field] || field}: ${auditValue(change?.from)} → ${auditValue(change?.to)}`
    );
  }
  if (row.action === 'status_change') {
    return [`${contactStatusLabel(d.from)} → ${contactStatusLabel(d.to)}`];
  }
  if (row.action === 'create') {
    return [`${d.display_name || ''} · ${auditValue(d.contact_type)}`.trim()];
  }
  return [auditValue(d)];
}

export default function ContactDetailClient({
  contact,
  isAdmin,
  partnerProfile,
  taxProfile,
  events,
  contracts,
  venueInquiries,
  collaborations,
  microParties,
  audit,
}) {
  const isContractor = isContractorContact(contact.contact_type);
  const timeline = useMemo(() => {
    const items = [
      ...events.map((e) => ({
        key: `event-${e.id}`,
        kind: 'event',
        title: e.title,
        date: e.event_date,
        href: `/bananas/events/${e.id}`,
        meta: [e.status?.toUpperCase(), e.slug ? `/events/${e.slug}` : null],
      })),
      ...contracts.map((c) => ({
        key: `contract-${c.id}`,
        kind: 'contract',
        title: c.counterparty_name || 'Contract',
        date: c.created_at,
        href: c.document_id ? `/bananas/documents/${c.document_id}` : null,
        meta: [
          c.status?.toUpperCase(),
          c.flat_fee_cents != null ? `${formatMoney(c.flat_fee_cents)} flat fee` : null,
        ],
      })),
      ...venueInquiries.map((i) => ({
        key: `venue-${i.id}`,
        kind: 'venue_inquiry',
        title: i.full_name,
        date: i.created_at,
        href: `/bananas/venue-inquiries/${i.id}`,
        meta: [i.status?.toUpperCase(), i.event_type, i.preferred_dates],
      })),
      ...collaborations.map((c) => ({
        key: `collab-${c.id}`,
        kind: 'collaboration',
        title: c.full_name,
        date: c.created_at,
        href: `/bananas/collaborations/${c.id}`,
        meta: [c.status?.toUpperCase(), c.collaborator_type],
      })),
      ...microParties.map((m) => ({
        key: `micro-${m.id}`,
        kind: 'micro_party',
        title: m.event_name || m.full_name,
        date: m.event_date || m.created_at,
        href: `/bananas/micro-parties/${m.id}`,
        meta: [m.status?.toUpperCase(), m.full_name],
      })),
    ];
    return items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }, [events, contracts, venueInquiries, collaborations, microParties]);

  const sectionStyle = { background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' };
  const sectionHeadingClass = 'text-[11px] font-bold tracking-[0.16em] mb-4';
  const sectionHeadingStyle = {
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    color: 'var(--auth-muted-strong)',
  };

  return (
    <>
      <AuthenticatedPageHeader
        backHref="/bananas/contacts"
        backLabel="← BACK TO CONTACTS"
        title={contact.display_name}
        titleClassName="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1]"
        className="mb-6"
      >
        {isAdmin && <DeleteContactButton contactId={contact.id} displayName={contact.display_name} />}
      </AuthenticatedPageHeader>

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <ContactTypeBadges types={contact.contact_type} />
        <ContactStatusBadge status={contact.status} />
      </div>
      <p className="text-[11px] mb-10" style={{ color: 'var(--auth-faint)' }}>
        Added {formatDateTime(contact.created_at)} · last updated {formatDateTime(contact.updated_at)}
      </p>

      {/* NO-W9 WARNING BANNER — page-level so it can't be missed. Only shown for
          admins viewing a DJ/artist/performer contact that doesn't have a W9 on
          file yet. A W9 isn't required to run the pay-request flow, but it's
          required to correctly issue a 1099-NEC at year-end — catching this on
          the contact page (before we cut a payment) is cheaper than chasing
          contractors down in January. */}
      {isAdmin && isContractor && !taxProfile?.w9_on_file && (
        <div
          className="mb-10 rounded-[12px] px-5 py-4 border flex items-start gap-3"
          style={{
            background: 'var(--auth-warn-bg)',
            borderColor: 'var(--auth-warn-border)',
            color: 'var(--auth-warn)',
          }}
          role="alert"
        >
          <span aria-hidden="true" className="text-[16px] leading-none mt-0.5">⚠</span>
          <div className="text-[13px] leading-[1.55]">
            <div className="font-semibold tracking-[0.02em] mb-1">
              No W9 on file for this contractor.
            </div>
            <div>
              Upload a signed W9 in the Tax Profile section below before year-end so
              this contact can receive a 1099-NEC. Not required to approve or send a
              pay request — required to issue their 1099.
            </div>
          </div>
        </div>
      )}

      <ContactForm contact={contact} />

      {/* PORTAL ACCESS — directly under the form's saved email field, because
          the email on file is what the invite is sent to. Admin-only: this
          creates a login. */}
      {isAdmin && (
        <section className="rounded-[14px] p-6 border mt-4" style={sectionStyle}>
          <h2 className={sectionHeadingClass} style={sectionHeadingStyle}>
            PORTAL ACCESS
          </h2>
          <InvitePartnerButton
            contactId={contact.id}
            email={contact.email}
            contactType={contact.contact_type}
            partnerProfile={partnerProfile}
            isContractor={isContractor}
          />
        </section>
      )}

      {/* TAX PROFILE — DJs/artists/performers get paid as 1099 contractors, so we
          track W9-on-file status here. Admin-only, mirrors Partner Access. */}
      {isAdmin && isContractor && (
        <TaxProfileSection contactId={contact.id} displayName={contact.display_name} taxProfile={taxProfile} />
      )}

      {/* LINKED ACTIVITY — auto-populated from anything carrying this contact_id.
          Doubles as the deal history: linked contracts show their flat fee. */}
      <section className="rounded-[14px] p-6 border mt-10" style={sectionStyle}>
        <h2 className={sectionHeadingClass} style={sectionHeadingStyle}>
          LINKED ACTIVITY ({timeline.length})
        </h2>
        {timeline.length === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
            Nothing linked yet. Events, contracts and inquiries appear here as soon as they are
            attached to this contact.
          </p>
        ) : (
          <div className="space-y-2">
            {timeline.map((item) => {
              const meta = (item.meta || []).filter(Boolean).join(' · ');
              const body = (
                <>
                  <span
                    className="text-[10px] font-semibold tracking-[0.12em] w-[120px] flex-shrink-0"
                    style={{ color: 'var(--auth-faint)' }}
                  >
                    {KIND_LABELS[item.kind]}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="text-[14px] font-semibold block truncate">{item.title}</span>
                    {meta && (
                      <span className="text-[12px]" style={{ color: 'var(--auth-muted)' }}>
                        {meta}
                      </span>
                    )}
                  </span>
                  <span className="text-[12px] flex-shrink-0" style={{ color: 'var(--auth-muted)' }}>
                    {formatDay(item.date)}
                  </span>
                </>
              );
              const className =
                'rounded-[10px] border p-3 flex items-center gap-3 transition-colors';
              const style = { background: 'var(--auth-card-bg-alt)', borderColor: 'var(--auth-card-border)' };
              return item.href ? (
                <Link key={item.key} href={item.href} className={className + ' hover:border-white/20'} style={style}>
                  {body}
                </Link>
              ) : (
                <div key={item.key} className={className} style={style}>
                  {body}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* EDIT HISTORY — append-only audit log, written server-side. */}
      <section className="rounded-[14px] p-6 border mt-4" style={sectionStyle}>
        <h2 className={sectionHeadingClass} style={sectionHeadingStyle}>
          EDIT HISTORY ({audit.length})
        </h2>
        {audit.length === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
            No changes recorded yet.
          </p>
        ) : (
          <div className="space-y-2">
            {audit.map((row) => (
              <div
                key={row.id}
                className="rounded-[10px] border p-3"
                style={{ background: 'var(--auth-card-bg-alt)', borderColor: 'var(--auth-card-border)' }}
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[13px] font-semibold">
                    {ACTION_LABELS[row.action] || row.action}
                  </span>
                  <span className="text-[12px] flex-1 truncate" style={{ color: 'var(--auth-muted-strong)' }}>
                    {row.actor_email || '—'}
                  </span>
                  <span className="text-[11px]" style={{ color: 'var(--auth-faint)' }}>
                    {formatDateTime(row.created_at)}
                  </span>
                </div>
                {auditLines(row).map((line, i) => (
                  <div
                    key={i}
                    className="text-[12px] mt-1.5 break-words"
                    style={{ color: 'var(--auth-muted)' }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
