'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CONTACT_TYPE_OPTIONS, CONTACT_STATUS_OPTIONS } from '@/lib/contact-helpers';
import { ContactStatusBadge, ContactTypeBadges } from './ContactBadges';

export default function ContactsList({ contacts }) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (typeFilter && !(c.contact_type || []).includes(typeFilter)) return false;
      if (statusFilter && c.status !== statusFilter) return false;
      if (!q) return true;
      return [c.display_name, c.primary_contact_name, c.company, c.email, c.phone, c.instagram_handle]
        .some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [contacts, query, typeFilter, statusFilter]);

  const inputStyle = {
    background: 'var(--auth-input-bg)',
    borderColor: 'var(--auth-input-border)',
    color: 'var(--auth-input-text)',
  };
  const inputClass = 'px-5 py-3 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30';

  return (
    <>
      <div className="flex flex-wrap gap-3 items-center mb-6">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, company, email, phone…"
          className={inputClass + ' flex-1 min-w-[240px]'}
          style={inputStyle}
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className={inputClass}
          style={inputStyle}
          aria-label="Filter by relationship type"
        >
          <option value="" style={{ background: '#141414' }}>All types</option>
          {CONTACT_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} style={{ background: '#141414' }}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={inputClass}
          style={inputStyle}
          aria-label="Filter by status"
        >
          <option value="" style={{ background: '#141414' }}>All statuses</option>
          {CONTACT_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} style={{ background: '#141414' }}>
              {opt.label}
            </option>
          ))}
        </select>
        <Link
          href="/bananas/contacts/new"
          className="px-6 py-3 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5"
          style={{ background: '#ffffff', color: '#0a0a0a' }}
        >
          + NEW CONTACT
        </Link>
      </div>

      <p className="text-[12px] mb-4" style={{ color: 'var(--auth-faint)' }}>
        {visible.length} of {contacts.length} contacts
      </p>

      {visible.length === 0 ? (
        <div
          className="rounded-[14px] p-12 text-center border"
          style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
        >
          <p style={{ color: 'var(--auth-muted)' }}>
            {contacts.length === 0
              ? 'No contacts yet. Add the first one to start building the directory.'
              : 'No contacts match these filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((c) => (
            <Link
              key={c.id}
              href={`/bananas/contacts/${c.id}`}
              className="block rounded-[14px] p-6 border transition-colors hover:border-white/20"
              style={{
                background: 'var(--auth-card-bg)',
                borderColor: c.status === 'do_not_book' ? 'rgba(239,68,68,0.4)' : 'var(--auth-card-border)',
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1 flex-wrap">
                    <h3
                      className="text-[18px] font-bold"
                      style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                    >
                      {c.display_name}
                    </h3>
                    {c.primary_contact_name && (
                      <span className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
                        {c.primary_contact_name}
                      </span>
                    )}
                  </div>
                  <div
                    className="text-[13px] flex flex-wrap gap-x-4 gap-y-1"
                    style={{ color: 'var(--auth-muted)' }}
                  >
                    {c.company && <span>{c.company}</span>}
                    {c.email && <span>{c.email}</span>}
                    {c.phone && <span>{c.phone}</span>}
                    {c.instagram_handle && <span>{c.instagram_handle}</span>}
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className="flex flex-wrap gap-1.5 justify-end mb-2">
                    <ContactTypeBadges types={c.contact_type} />
                  </div>
                  <ContactStatusBadge status={c.status} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
