'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ENTITY_TYPES = [
  { value: 'individual', label: 'Individual' },
  { value: 'llc', label: 'LLC' },
  { value: 'other', label: 'Other' },
];

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Admin-only section for contractor-type contacts (DJ/artist/performer): track
// entity type + whether a signed W9 is on file, and let an admin upload one.
// The upload itself goes through the existing Documents Hub endpoint (category
// "tax") so it gets the same access-logged storage as every other document —
// this component only ever links a document id, it never stores the file.
export default function TaxProfileSection({ contactId, displayName, taxProfile: initialTaxProfile }) {
  const router = useRouter();
  const [taxProfile, setTaxProfile] = useState(initialTaxProfile);
  const [entityType, setEntityType] = useState(initialTaxProfile?.entity_type || 'individual');
  const [uploading, setUploading] = useState(false);
  const [savingEntity, setSavingEntity] = useState(false);
  const [error, setError] = useState('');

  const patchTaxProfile = async (body) => {
    const res = await fetch(`/api/admin/contacts/${contactId}/tax-profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || 'Request failed.');
    return data.taxProfile;
  };

  const handleEntityTypeChange = async (value) => {
    setEntityType(value);
    setSavingEntity(true);
    setError('');
    try {
      const saved = await patchTaxProfile({ entity_type: value });
      setTaxProfile(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingEntity(false);
    }
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('title', `W9 — ${displayName}`);
      form.append('category', 'tax');
      form.append('counterparty', displayName);
      form.append('file', file);

      const uploadRes = await fetch('/api/admin/documents', { method: 'POST', body: form });
      const uploadData = await uploadRes.json().catch(() => null);
      if (!uploadRes.ok) throw new Error(uploadData?.error || 'Upload failed.');

      const saved = await patchTaxProfile({ w9_document_id: uploadData.document_id });
      setTaxProfile(saved);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleClearW9 = async () => {
    setError('');
    try {
      const saved = await patchTaxProfile({ w9_on_file: false });
      setTaxProfile(saved);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="rounded-[14px] p-6 border mt-4" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
      <h2 className="text-[11px] font-bold tracking-[0.16em] mb-4" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: 'var(--auth-muted-strong)' }}>
        TAX PROFILE (1099 / W9)
      </h2>

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <label className="text-[12px]" style={{ color: 'var(--auth-muted)' }}>
          Paid as
          <select
            value={entityType}
            onChange={(e) => handleEntityTypeChange(e.target.value)}
            disabled={savingEntity}
            className="ml-2 rounded-md px-2 py-1 text-[12px] border bg-transparent"
            style={{ borderColor: 'var(--auth-card-border-strong)', color: 'var(--auth-text)' }}
          >
            {ENTITY_TYPES.map((t) => (
              <option key={t.value} value={t.value} style={{ color: '#000' }}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <span
          className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full"
          style={
            taxProfile?.w9_on_file
              ? { background: 'var(--auth-success-bg)', color: 'var(--auth-success)', border: '1px solid var(--auth-success-border)' }
              : { background: 'var(--auth-warn-bg)', color: 'var(--auth-warn)', border: '1px solid var(--auth-warn-border)' }
          }
        >
          {taxProfile?.w9_on_file ? 'W9 ON FILE' : 'NO W9 ON FILE'}
        </span>

        {taxProfile?.w9_on_file && taxProfile?.w9_received_at && (
          <span className="text-[12px]" style={{ color: 'var(--auth-muted)' }}>
            Received {formatDate(taxProfile.w9_received_at)}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Only offer to view the linked document while it's actually considered on
            file. After a "Mark not on file" the row still points at the document
            (kept for audit trail — you can still find it in the Documents Hub),
            but the badge above says NO W9, so offering "VIEW CURRENT W9" here
            would contradict itself. */}
        {taxProfile?.w9_on_file && taxProfile?.w9_document_id && (
          <a
            href={`/api/admin/documents/${taxProfile.w9_document_id}/download?inline=1`}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.1em] border hover:bg-white/5"
            style={{ borderColor: 'var(--auth-card-border-strong)', color: 'var(--auth-text)' }}
          >
            VIEW CURRENT W9
          </a>
        )}

        <label
          className="px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.1em] border cursor-pointer hover:bg-white/5"
          style={{ borderColor: 'var(--auth-card-border-strong)', color: 'var(--auth-text)' }}
        >
          {uploading ? 'UPLOADING...' : taxProfile?.w9_on_file ? 'REPLACE W9' : 'UPLOAD W9'}
          <input type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" disabled={uploading} onChange={handleUpload} />
        </label>

        {taxProfile?.w9_on_file && (
          <button
            type="button"
            onClick={handleClearW9}
            className="text-[11px] tracking-[0.08em]"
            style={{ color: 'var(--auth-muted)' }}
          >
            Mark not on file
          </button>
        )}
      </div>

      <p className="text-[12px] mt-3" style={{ color: 'var(--auth-muted)' }}>
        The signed W9 itself is stored in the Documents Hub (private, access-logged) — this just tracks whether one is
        on file. No SSN/EIN is ever stored outside the document itself. Once pay requests are live, this contact&rsquo;s
        cumulative paid amount for the year will show here too.
      </p>

      {error && (
        <p className="text-[13px] mt-3" style={{ color: 'var(--auth-danger)' }}>
          {error}
        </p>
      )}
    </section>
  );
}
