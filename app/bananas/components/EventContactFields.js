'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { contactTypeLabel } from '@/lib/contact-helpers';

// The "who is this event with" block shared by both event-creation flows
// (EventForm.js and TtEventCreator.js) so the rule looks and behaves identically
// in each: every event either belongs to an outside partner — and must name the
// Contact — or is explicitly flagged SDG-only.
//
// Client-side blocking lives in each form's handleSubmit; the server route and
// the events_contact_required_unless_sdg_only CHECK constraint are the backstops.
export default function EventContactFields({ isSdgOnly, onSdgOnlyChange, contactId, onContactIdChange }) {
  const [contacts, setContacts] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('contacts')
        .select('id, display_name, company, contact_type, status')
        .order('display_name', { ascending: true });
      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        return;
      }
      setContacts(data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleContacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    // Never filter out the current selection, or the select would silently lose it.
    return contacts.filter(
      (c) =>
        c.id === contactId ||
        [c.display_name, c.company].some((v) => (v || '').toLowerCase().includes(q))
    );
  }, [contacts, search, contactId]);

  const selected = contacts.find((c) => c.id === contactId) || null;

  const inputStyle = {
    background: 'var(--auth-input-bg)',
    borderColor: 'var(--auth-input-border)',
    color: 'var(--auth-input-text)',
  };
  const labelClass = 'block text-[12px] font-semibold tracking-[0.14em] mb-2';
  const labelStyle = { color: 'var(--auth-muted)' };
  const inputClass =
    'w-full px-5 py-3.5 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30';

  return (
    <div>
      <label className={labelClass} style={labelStyle}>WHO IS THIS EVENT WITH?</label>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onSdgOnlyChange(false)}
          className="py-4 px-5 rounded-[10px] border text-left transition-all"
          style={{
            background: !isSdgOnly ? 'var(--auth-text-strong)' : 'var(--auth-card-bg)',
            borderColor: !isSdgOnly ? 'var(--auth-text-strong)' : 'var(--auth-card-border)',
            color: !isSdgOnly ? 'var(--auth-strong-surface-text)' : 'var(--auth-text)',
          }}
        >
          <div className="text-[14px] font-bold mb-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Outside Partner
          </div>
          <div className="text-[12px]" style={{ color: !isSdgOnly ? 'var(--auth-faint)' : 'var(--auth-muted)' }}>
            Organizer, collective, renter or vendor
          </div>
        </button>
        <button
          type="button"
          onClick={() => onSdgOnlyChange(true)}
          className="py-4 px-5 rounded-[10px] border text-left transition-all"
          style={{
            background: isSdgOnly ? 'var(--auth-accent)' : 'var(--auth-card-bg)',
            borderColor: isSdgOnly ? 'var(--auth-accent)' : 'var(--auth-card-border)',
            color: isSdgOnly ? 'var(--auth-accent-text)' : 'var(--auth-text)',
          }}
        >
          <div className="text-[14px] font-bold mb-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            SDG Only
          </div>
          <div className="text-[12px]" style={{ color: isSdgOnly ? 'var(--auth-accent-text)' : 'var(--auth-muted)' }}>
            Fully internal · no contact needed
          </div>
        </button>
      </div>

      {!isSdgOnly && (
        <div className="mt-4">
          <label className={labelClass} style={labelStyle}>
            CONTACT <span style={{ color: '#ff8080' }}>*</span>
          </label>
          {contacts.length > 8 && (
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts by name or company…"
              className={inputClass + ' mb-2'}
              style={inputStyle}
            />
          )}
          <select
            value={contactId || ''}
            onChange={(e) => onContactIdChange(e.target.value || null)}
            required
            className={inputClass}
            style={inputStyle}
          >
            <option value="" style={{ background: '#141414' }}>
              — Select a contact —
            </option>
            {visibleContacts.map((c) => (
              <option key={c.id} value={c.id} style={{ background: '#141414' }}>
                {c.display_name}
                {c.company ? ` · ${c.company}` : ''}
                {c.contact_type?.length ? ` (${c.contact_type.map(contactTypeLabel).join(', ')})` : ''}
              </option>
            ))}
          </select>

          {selected?.status === 'do_not_book' && (
            <p className="text-[11px] mt-2" style={{ color: '#ff8080' }}>
              This contact is flagged DO NOT BOOK. Check with Adam before going ahead.
            </p>
          )}
          <p className="text-[11px] mt-2" style={{ color: '#555' }}>
            {loadError
              ? `Could not load contacts (${loadError}).`
              : contacts.length === 0
                ? 'No contacts yet.'
                : 'Required for any event with an outside partner.'}{' '}
            <Link href="/bananas/contacts/new" className="underline">
              Add a new contact
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
