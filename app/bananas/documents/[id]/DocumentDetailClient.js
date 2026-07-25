'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import ContractPanel from './ContractPanel';
import ContractFieldsPanel from './ContractFieldsPanel';
import ContractFinancialsPanel from './ContractFinancialsPanel';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

function formatBytes(n) {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
function formatDateTime(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}
const ACTION_LABEL = {
  upload: 'Uploaded', view: 'Viewed', download: 'Downloaded',
  update_metadata: 'Edited', delete: 'Deleted', restore: 'Restored',
  new_version: 'New version',
  contract_create: 'Contract created', contract_status_change: 'Contract status',
  contract_send: 'Contract sent', contract_signed: 'Contract signed', contract_void: 'Contract voided',
};

export default function DocumentDetailClient({ document: doc, versions, audit, events, categories, contract, signNowConfigured, contractTemplatesEnabled = false }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [uploadingVersion, setUploadingVersion] = useState(false);

  const [edit, setEdit] = useState({
    title: doc.title,
    description: doc.description || '',
    category: doc.category,
    counterparty: doc.counterparty || '',
    event_id: doc.event_id || '',
    status: doc.status,
    tags: (doc.document_tags || []).map((t) => t.tag).join(', '),
  });

  async function save() {
    setSaving(true); setError(null);
    try {
      const body = {
        title: edit.title,
        description: edit.description,
        category: edit.category,
        counterparty: edit.counterparty,
        event_id: edit.event_id || null,
        status: edit.status,
        tags: edit.tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      await adminFetch(`/api/admin/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function uploadNewVersion(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingVersion(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await adminFetch(`/api/admin/documents/${doc.id}/version`, { method: 'POST', body: fd });
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingVersion(false);
      e.target.value = '';
    }
  }

  const tags = (doc.document_tags || []).map((t) => t.tag);

  return (
    <>
      <AuthenticatedPageHeader
        backHref="/bananas/documents"
        backLabel="← BACK TO DOCUMENTS"
        title={doc.title}
        titleClassName="text-[28px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-6"
      >
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-[12px] px-3 py-1.5 rounded-[8px]"
            style={{ border: '1px solid var(--auth-ghost-border)', color: 'var(--auth-ghost-text)' }}
          >
            Edit
          </button>
        )}
      </AuthenticatedPageHeader>

      {error && (
        <div className="mb-4 p-3 rounded-[10px] text-[13px]" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>
          {error}
        </div>
      )}

      {/* Metadata card */}
      <div className="rounded-[14px] border p-5 mb-6" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
        {editing ? (
          <div className="space-y-3">
            <input
              value={edit.title}
              onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              className="w-full px-3 py-2.5 text-[14px] rounded-[10px] outline-none"
              style={{ background: 'var(--auth-input-bg)', border: '1px solid var(--auth-input-border)', color: 'var(--auth-input-text)' }}
            />
            <div className="grid grid-cols-2 gap-3">
              <select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}
                className="px-3 py-2.5 text-[14px] rounded-[10px] outline-none cursor-pointer"
                style={{ background: 'var(--auth-input-bg)', border: '1px solid var(--auth-input-border)', color: 'var(--auth-input-text)' }}>
                {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}
                className="px-3 py-2.5 text-[14px] rounded-[10px] outline-none cursor-pointer"
                style={{ background: 'var(--auth-input-bg)', border: '1px solid var(--auth-input-border)', color: 'var(--auth-input-text)' }}>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <input placeholder="Counterparty" value={edit.counterparty}
              onChange={(e) => setEdit({ ...edit, counterparty: e.target.value })}
              className="w-full px-3 py-2.5 text-[14px] rounded-[10px] outline-none"
              style={{ background: 'var(--auth-input-bg)', border: '1px solid var(--auth-input-border)', color: 'var(--auth-input-text)' }}
            />
            <select value={edit.event_id} onChange={(e) => setEdit({ ...edit, event_id: e.target.value })}
              className="w-full px-3 py-2.5 text-[14px] rounded-[10px] outline-none cursor-pointer"
              style={{ background: 'var(--auth-input-bg)', border: '1px solid var(--auth-input-border)', color: 'var(--auth-input-text)' }}>
              <option value="">No event link</option>
              {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}{ev.event_date ? ` · ${ev.event_date}` : ''}</option>)}
            </select>
            <input placeholder="Tags (comma-separated)" value={edit.tags}
              onChange={(e) => setEdit({ ...edit, tags: e.target.value })}
              className="w-full px-3 py-2.5 text-[14px] rounded-[10px] outline-none"
              style={{ background: 'var(--auth-input-bg)', border: '1px solid var(--auth-input-border)', color: 'var(--auth-input-text)' }}
            />
            <textarea placeholder="Description" value={edit.description} rows={3}
              onChange={(e) => setEdit({ ...edit, description: e.target.value })}
              className="w-full px-3 py-2.5 text-[14px] rounded-[10px] outline-none resize-none"
              style={{ background: 'var(--auth-input-bg)', border: '1px solid var(--auth-input-border)', color: 'var(--auth-input-text)' }}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(false)} disabled={saving}
                className="px-4 py-2 text-[13px] rounded-[10px]"
                style={{ border: '1px solid var(--auth-ghost-border)', color: 'var(--auth-ghost-text)' }}>Cancel</button>
              <button onClick={save} disabled={saving}
                className="px-5 py-2 text-[13px] font-semibold rounded-[10px] tracking-[0.06em] uppercase"
                style={{ background: 'var(--auth-text-strong)', color: 'var(--auth-strong-surface-text)', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-[13px]">
            <dt style={{ color: 'var(--auth-muted)' }}>Category</dt><dd>{doc.category}</dd>
            <dt style={{ color: 'var(--auth-muted)' }}>Status</dt><dd>{doc.status}</dd>
            {doc.counterparty && (<><dt style={{ color: 'var(--auth-muted)' }}>Counterparty</dt><dd>{doc.counterparty}</dd></>)}
            {doc.events && (<><dt style={{ color: 'var(--auth-muted)' }}>Event</dt><dd>{doc.events.title}{doc.events.event_date ? ` · ${doc.events.event_date}` : ''}</dd></>)}
            {doc.description && (<><dt style={{ color: 'var(--auth-muted)' }}>Notes</dt><dd className="whitespace-pre-wrap">{doc.description}</dd></>)}
            {tags.length > 0 && (
              <>
                <dt style={{ color: 'var(--auth-muted)' }}>Tags</dt>
                <dd className="flex flex-wrap gap-1">
                  {tags.map((t) => <span key={t} className="text-[11px] px-1.5 py-0.5 rounded-[4px]" style={{ background: 'var(--auth-card-bg-alt)', color: 'var(--auth-muted-strong)' }}>#{t}</span>)}
                </dd>
              </>
            )}
            <dt style={{ color: 'var(--auth-muted)' }}>Created</dt><dd>{formatDateTime(doc.created_at)}</dd>
            <dt style={{ color: 'var(--auth-muted)' }}>Updated</dt><dd>{formatDateTime(doc.updated_at)}</dd>
          </dl>
        )}
      </div>

      {/* Contract lifecycle — only for contract-category documents */}
      {doc.category === 'contracts' && (
        <ContractPanel
          documentId={doc.id}
          initialContract={contract}
          events={events}
          signNowConfigured={signNowConfigured}
        />
      )}

      {/* Fields + business-value fill — only for contract-category documents.
          The panel creates the contract record lazily on first field save.
          Hidden entirely when the contract-templates feature flag is off. */}
      {contractTemplatesEnabled && doc.category === 'contracts' && versions.length > 0 && (
        <ContractFieldsPanel documentId={doc.id} initialContract={contract} />
      )}

      {/* Financial terms — only once a contract record exists. */}
      {doc.category === 'contracts' && contract && (
        <ContractFinancialsPanel documentId={doc.id} initial={contract} />
      )}

      {/* Versions */}
      <div className="mb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase" style={{ color: '#8a8a8a' }}>
            Versions ({versions.length})
          </h2>
          <label className="text-[12px] cursor-pointer hover:underline" style={{ color: 'white' }}>
            {uploadingVersion ? 'Uploading…' : '+ Upload new version'}
            <input type="file" className="hidden" disabled={uploadingVersion} onChange={uploadNewVersion} />
          </label>
        </div>
        <div className="space-y-2">
          {versions.map((v) => (
            <div key={v.id}
              className="rounded-[10px] border p-3 flex items-center gap-3"
              style={{ background: '#141414', borderColor: v.id === doc.current_version_id ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.06)' }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[14px] font-semibold">v{v.version_number}</span>
                  {v.id === doc.current_version_id && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-[4px]" style={{ background: 'rgba(74,222,128,0.12)', color: '#4ade80' }}>CURRENT</span>
                  )}
                  <span className="text-[13px] truncate" style={{ color: '#c8c8c8' }}>{v.filename}</span>
                </div>
                <div className="text-[11px]" style={{ color: '#8a8a8a' }}>
                  {formatBytes(v.size_bytes)} · {v.mime_type || 'unknown'} · uploaded {formatDateTime(v.uploaded_at)}
                </div>
              </div>
              <a href={`/api/admin/documents/${doc.id}/download?inline=1&version=${v.id}`} target="_blank" rel="noreferrer"
                className="text-[12px] px-3 py-1.5 rounded-[8px] hover:bg-white/10"
                style={{ border: '1px solid rgba(255,255,255,0.10)', color: 'white' }}>View</a>
              <a href={`/api/admin/documents/${doc.id}/download?version=${v.id}`}
                className="text-[12px] px-3 py-1.5 rounded-[8px] hover:bg-white/10"
                style={{ border: '1px solid rgba(255,255,255,0.10)', color: 'white' }}>Download</a>
            </div>
          ))}
        </div>
      </div>

      {/* Audit */}
      <div>
        <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase mb-3" style={{ color: '#8a8a8a' }}>
          Activity ({audit.length})
        </h2>
        {audit.length === 0 ? (
          <p className="text-[13px]" style={{ color: '#8a8a8a' }}>No activity recorded yet.</p>
        ) : (
          <div className="rounded-[12px] border overflow-hidden" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}>
            {audit.map((row, i) => (
              <div key={row.id} className="px-4 py-2.5 flex items-center gap-3 text-[12px]"
                style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.04)' }}>
                <span className="font-semibold w-24 flex-shrink-0">{ACTION_LABEL[row.action] || row.action}</span>
                <span className="flex-1 truncate" style={{ color: '#c8c8c8' }}>{row.actor_email || '—'}</span>
                <span className="flex-shrink-0" style={{ color: '#8a8a8a' }}>{formatDateTime(row.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
