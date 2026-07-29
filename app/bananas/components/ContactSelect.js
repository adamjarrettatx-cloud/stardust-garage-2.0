'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { contactTypeLabel } from '@/lib/contact-helpers';

// The searchable "pick a Contact" control, shared by every admin surface that
// attaches a contact to something (the event form's "who is this event with"
// block, the guest list allocation panel). The search box only appears once the
// directory is long enough to need it, and the current selection is never
// filtered out — otherwise the select would silently lose its value.
export default function ContactSelect({
  value,
  onChange,
  required = false,
  excludeIds = [],
  hint = null,
  disabled = false,
}) {
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

  const selectable = useMemo(
    () => contacts.filter((c) => c.id === value || !excludeIds.includes(c.id)),
    [contacts, value, excludeIds]
  );

  const visibleContacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return selectable;
    return selectable.filter(
      (c) =>
        c.id === value ||
        [c.display_name, c.company].some((v) => (v || '').toLowerCase().includes(q))
    );
  }, [selectable, search, value]);

  const selected = contacts.find((c) => c.id === value) || null;

  const inputStyle = {
    background: 'var(--auth-input-bg)',
    borderColor: 'var(--auth-input-border)',
    color: 'var(--auth-input-text)',
  };
  const inputClass =
    'w-full px-5 py-3.5 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30';

  return (
    <div>
      {selectable.length > 8 && (
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search contacts by name or company…"
          className={inputClass + ' mb-2'}
          style={inputStyle}
          disabled={disabled}
        />
      )}
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        required={required}
        disabled={disabled}
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
            : hint}{' '}
        <Link href="/bananas/contacts/new" className="underline">
          Add a new contact
        </Link>
        .
      </p>
    </div>
  );
}
