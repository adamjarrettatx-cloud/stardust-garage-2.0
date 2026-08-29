'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  CONTACT_TYPE_OPTIONS,
  CONTACT_STATUS_OPTIONS,
} from '@/lib/contact-helpers';
import {
  ENTITY_TYPE_OPTIONS,
  buildOrganizerPatch,
  needsLegalCounterpartyFields,
} from '@/lib/event-organizer';

// The legal-counterparty fields, in render order. Kept as data so the fieldset
// stays a single source of truth with lib/event-organizer.js and the migration.
const ADDRESS_FIELDS = [
  { key: 'address_line1', label: 'STREET ADDRESS', span: 2, placeholder: '1234 Example St' },
  { key: 'address_line2', label: 'SUITE / UNIT', span: 2, placeholder: 'Optional' },
  { key: 'address_city', label: 'CITY', span: 1 },
  { key: 'address_state', label: 'STATE', span: 1, placeholder: 'TX' },
  { key: 'address_postal_code', label: 'ZIP / POSTAL', span: 1 },
  { key: 'address_country', label: 'COUNTRY', span: 1, placeholder: 'USA' },
];

function emptyAdditionalContact() {
  return { name: '', role: '', email: '', phone: '' };
}

// Turn the saved payload + the previous row into a compact { field: {from, to} }
// map. This is what the audit log renders as the human-readable diff, so it only
// carries fields that actually changed.
function diffFields(previous, next) {
  const changed = {};
  for (const key of Object.keys(next)) {
    const before = previous?.[key] ?? null;
    const after = next[key] ?? null;
    const same =
      typeof before === 'object' || typeof after === 'object'
        ? JSON.stringify(before) === JSON.stringify(after)
        : before === after;
    if (!same) changed[key] = { from: before, to: after };
  }
  return changed;
}

// Shared create/edit form. `contact` is null on the create page and the existing
// row on the detail page — the only behavioural differences are the insert vs
// update call and the audit action that follows it.
export default function ContactForm({ contact = null }) {
  const router = useRouter();
  const isEditing = !!contact;

  const [displayName, setDisplayName] = useState(contact?.display_name || '');
  const [contactTypes, setContactTypes] = useState(contact?.contact_type || []);
  const [primaryContactName, setPrimaryContactName] = useState(contact?.primary_contact_name || '');
  const [email, setEmail] = useState(contact?.email || '');
  const [phone, setPhone] = useState(contact?.phone || '');
  const [company, setCompany] = useState(contact?.company || '');
  const [instagramHandle, setInstagramHandle] = useState(contact?.instagram_handle || '');
  const [website, setWebsite] = useState(contact?.website || '');
  const [status, setStatus] = useState(contact?.status || 'active');
  const [internalNotes, setInternalNotes] = useState(contact?.internal_notes || '');
  const [photoUrl, setPhotoUrl] = useState(contact?.photo_url || '');
  const [additionalContacts, setAdditionalContacts] = useState(
    Array.isArray(contact?.additional_contacts) ? contact.additional_contacts : []
  );

  // Legal-counterparty block — what has to be true about a profile before it can
  // be named on a contract and sent for signature.
  const [legalName, setLegalName] = useState(contact?.legal_name || '');
  const [entityType, setEntityType] = useState(contact?.entity_type || '');
  const [address, setAddress] = useState(() =>
    ADDRESS_FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: contact?.[f.key] || '' }), {})
  );
  const [defaultSignerName, setDefaultSignerName] = useState(contact?.default_signer_name || '');
  const [defaultSignerEmail, setDefaultSignerEmail] = useState(contact?.default_signer_email || '');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Shown for Event Organizers and the other types that sign agreements. Always
  // shown when the row already has legal data, so an existing profile can never
  // hide fields that are currently populated.
  const showLegalFields =
    needsLegalCounterpartyFields(contactTypes) ||
    !!(legalName || entityType || defaultSignerName || defaultSignerEmail) ||
    ADDRESS_FIELDS.some((f) => address[f.key]);

  const toggleType = (value) => {
    setContactTypes((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const updateAdditional = (index, field, value) => {
    setAdditionalContacts((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  };

  const addAdditional = () => setAdditionalContacts((prev) => [...prev, emptyAdditionalContact()]);

  const removeAdditional = (index) =>
    setAdditionalContacts((prev) => prev.filter((_, i) => i !== index));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (contactTypes.length === 0) {
      setError('Pick at least one relationship type so the directory stays searchable.');
      return;
    }

    // Same pure validator the server route uses, so the client can't produce a
    // payload the API would reject.
    const organizer = buildOrganizerPatch({
      legal_name: legalName,
      entity_type: entityType,
      default_signer_name: defaultSignerName,
      default_signer_email: defaultSignerEmail,
      ...ADDRESS_FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: address[f.key] }), {}),
    });
    if (!organizer.ok) {
      setError(organizer.error);
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const payload = {
      display_name: displayName.trim(),
      contact_type: contactTypes,
      primary_contact_name: primaryContactName.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      company: company.trim() || null,
      instagram_handle: instagramHandle.trim() || null,
      website: website.trim() || null,
      status,
      internal_notes: internalNotes.trim() || null,
      photo_url: photoUrl.trim() || null,
      // Drop rows the user added but left completely blank.
      additional_contacts: additionalContacts.filter((c) =>
        [c.name, c.role, c.email, c.phone].some((v) => (v || '').trim())
      ),
      ...organizer.patch,
      updated_by: user?.id || null,
    };
    if (!isEditing) payload.created_by = user?.id || null;

    const { data: saved, error: saveError } = isEditing
      ? await supabase.from('contacts').update(payload).eq('id', contact.id).select().single()
      : await supabase.from('contacts').insert(payload).select().single();

    if (saveError) {
      setError('Save failed: ' + saveError.message);
      setSaving(false);
      return;
    }

    // Audit writes go through the server route so ip/user-agent are the real
    // request's. A failed audit call must not lose the save the user just made,
    // so it never blocks navigation.
    const logAudit = async (action, details) => {
      try {
        await fetch(`/api/admin/contacts/${saved.id}/audit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, details }),
        });
      } catch (err) {
        console.error('Contact audit log failed:', err);
      }
    };

    if (isEditing) {
      const changed = diffFields(contact, payload);
      delete changed.updated_by;
      if (Object.keys(changed).length > 0) {
        await logAudit('update', { changed });
      }
      if (contact.status !== status) {
        await logAudit('status_change', { from: contact.status, to: status });
      }
    } else {
      await logAudit('create', { display_name: payload.display_name, contact_type: payload.contact_type });
    }

    router.push(`/bananas/contacts/${saved.id}`);
    router.refresh();
  };

  const inputStyle = {
    background: 'var(--auth-input-bg)',
    borderColor: 'var(--auth-input-border)',
    color: 'var(--auth-input-text)',
  };

  const labelClass = 'block text-[12px] font-semibold tracking-[0.14em] mb-2';
  const labelStyle = { color: 'var(--auth-muted)' };
  const inputClass = 'w-full px-5 py-3.5 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30';

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className={labelClass} style={labelStyle}>DISPLAY NAME</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          placeholder="Person, collective or company as you'd search for it"
          className={inputClass}
          style={inputStyle}
        />
      </div>

      <div>
        <label className={labelClass} style={labelStyle}>RELATIONSHIP TYPE</label>
        <div className="flex flex-wrap gap-2">
          {CONTACT_TYPE_OPTIONS.map((opt) => {
            const on = contactTypes.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleType(opt.value)}
                aria-pressed={on}
                className="px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-all"
                style={{
                  background: on ? 'var(--auth-text-strong)' : 'var(--auth-card-bg)',
                  borderColor: on ? 'var(--auth-text-strong)' : 'var(--auth-card-border)',
                  color: on ? 'var(--auth-strong-surface-text)' : 'var(--auth-text)',
                }}
              >
                {opt.label.toUpperCase()}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] mt-2" style={{ color: '#555' }}>
          Pick every type that applies — a collective can also be a venue renter.
        </p>
      </div>

      <div>
        <label className={labelClass} style={labelStyle}>STATUS</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={inputClass}
          style={inputStyle}
        >
          {CONTACT_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {status === 'do_not_book' && (
          <p className="text-[11px] mt-2" style={{ color: '#ff8080' }}>
            Do Not Book is flagged in red across the directory so nobody books them by accident.
          </p>
        )}
        {status === 'archived' && (
          <p className="text-[11px] mt-2" style={{ color: '#ffb84d' }}>
            Archived profiles stay on file for signed contracts and history, but are hidden from
            pickers and cannot be sent new contracts.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass} style={labelStyle}>PRIMARY CONTACT NAME</label>
          <input
            type="text"
            value={primaryContactName}
            onChange={(e) => setPrimaryContactName(e.target.value)}
            placeholder="Who we actually talk to"
            className={inputClass}
            style={inputStyle}
          />
        </div>
        <div>
          <label className={labelClass} style={labelStyle}>COMPANY / ORGANIZATION</label>
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className={inputClass}
            style={inputStyle}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass} style={labelStyle}>EMAIL</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            style={inputStyle}
          />
        </div>
        <div>
          <label className={labelClass} style={labelStyle}>PHONE</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputClass}
            style={inputStyle}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass} style={labelStyle}>INSTAGRAM</label>
          <input
            type="text"
            value={instagramHandle}
            onChange={(e) => setInstagramHandle(e.target.value)}
            placeholder="@handle"
            className={inputClass}
            style={inputStyle}
          />
        </div>
        <div>
          <label className={labelClass} style={labelStyle}>WEBSITE</label>
          <input
            type="text"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://..."
            className={inputClass}
            style={inputStyle}
          />
        </div>
      </div>

      {/* LEGAL COUNTERPARTY — what goes on the agreement itself. Only rendered
          for types that actually sign with us, so the form stays short for a
          plain DJ contact. */}
      {showLegalFields && (
        <div
          className="rounded-[12px] border p-5"
          style={{ background: '#121212', borderColor: 'rgba(255,255,255,0.08)' }}
        >
          <div className="mb-1 text-[12px] font-semibold tracking-[0.14em]" style={{ color: '#f5f5f5' }}>
            LEGAL &amp; SIGNING DETAILS
          </div>
          <p className="text-[11px] mb-5" style={{ color: '#777' }}>
            Used to fill contracts and route signature requests. Complete this before creating a
            contract for this counterparty.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass} style={labelStyle}>LEGAL NAME</label>
              <input
                type="text"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="Exact name on the agreement"
                className={inputClass}
                style={inputStyle}
              />
              <p className="text-[11px] mt-2" style={{ color: '#555' }}>
                Leave blank to use the display name.
              </p>
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>ENTITY TYPE</label>
              <select
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
                className={inputClass}
                style={inputStyle}
              >
                <option value="">Not specified</option>
                {ENTITY_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            {ADDRESS_FIELDS.map((f) => (
              <div key={f.key} className={f.span === 2 ? 'sm:col-span-2' : ''}>
                <label className={labelClass} style={labelStyle}>{f.label}</label>
                <input
                  type="text"
                  value={address[f.key]}
                  onChange={(e) => setAddress((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder || ''}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div>
              <label className={labelClass} style={labelStyle}>DEFAULT SIGNER NAME</label>
              <input
                type="text"
                value={defaultSignerName}
                onChange={(e) => setDefaultSignerName(e.target.value)}
                placeholder="Who signs on their behalf"
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>DEFAULT SIGNER EMAIL</label>
              <input
                type="email"
                value={defaultSignerEmail}
                onChange={(e) => setDefaultSignerEmail(e.target.value)}
                placeholder="Where signature requests go"
                className={inputClass}
                style={inputStyle}
              />
              <p className="text-[11px] mt-2" style={{ color: '#555' }}>
                Falls back to the email above if blank.
              </p>
            </div>
          </div>
        </div>
      )}

      <div>
        <label className={labelClass} style={labelStyle}>INTERNAL NOTES</label>
        <textarea
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
          rows={6}
          placeholder="Internal only — never shown outside the admin panel."
          className={inputClass + ' resize-y'}
          style={inputStyle}
        />
      </div>

      {/* ADDITIONAL CONTACTS — extra people at the same organization */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className={labelClass + ' mb-0'} style={labelStyle}>ADDITIONAL CONTACTS</label>
          <button
            type="button"
            onClick={addAdditional}
            className="px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors hover:bg-white/5"
            style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
          >
            + ADD PERSON
          </button>
        </div>

        {additionalContacts.length === 0 ? (
          <p className="text-[11px]" style={{ color: '#555' }}>
            Add tour managers, bookers or anyone else we deal with at this organization.
          </p>
        ) : (
          <div className="space-y-4">
            {additionalContacts.map((c, i) => (
              <div
                key={i}
                className="rounded-[12px] border p-4"
                style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.08)' }}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-semibold tracking-[0.14em]" style={{ color: '#8a8a8a' }}>
                    PERSON {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAdditional(i)}
                    className="text-[11px] font-semibold tracking-[0.12em] transition-opacity hover:opacity-70"
                    style={{ color: '#ff8080' }}
                  >
                    REMOVE
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { field: 'name', label: 'NAME', type: 'text' },
                    { field: 'role', label: 'ROLE', type: 'text' },
                    { field: 'email', label: 'EMAIL', type: 'email' },
                    { field: 'phone', label: 'PHONE', type: 'tel' },
                  ].map((f) => (
                    <div key={f.field}>
                      <label className="block text-[10px] font-semibold tracking-[0.12em] mb-1.5" style={{ color: '#8a8a8a' }}>
                        {f.label}
                      </label>
                      <input
                        type={f.type}
                        value={c[f.field] || ''}
                        onChange={(e) => updateAdditional(i, f.field, e.target.value)}
                        className={inputClass + ' py-2.5'}
                        style={inputStyle}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className={labelClass} style={labelStyle}>PHOTO URL</label>
        {photoUrl && (
          <div className="mb-3 rounded-[10px] overflow-hidden border" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl} alt="Contact preview" className="w-full h-auto max-h-[260px] object-cover" />
          </div>
        )}
        <input
          type="text"
          value={photoUrl}
          onChange={(e) => setPhotoUrl(e.target.value)}
          placeholder="Paste an image URL"
          className={inputClass}
          style={inputStyle}
        />
      </div>

      {error && (
        <div className="text-[13px] text-red-400 p-3 rounded-[10px] border border-red-500/30 bg-red-500/10">
          {error}
        </div>
      )}

      <div className="flex gap-3 pt-4">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
          style={{ background: '#ffffff', color: '#0a0a0a' }}
        >
          {saving ? 'SAVING...' : isEditing ? 'SAVE CHANGES' : 'CREATE CONTACT'}
        </button>
        <Link
          href="/bananas/contacts"
          className="px-8 py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] border transition-colors hover:bg-white/5 flex items-center"
          style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
        >
          CANCEL
        </Link>
      </div>
    </form>
  );
}
