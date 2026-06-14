'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function formatBytes(n) {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function formatDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const CONTRACT_STATUS_COLOR = {
  draft: '#8a8a8a', pending_review: '#fbbf24', sent: '#60a5fa',
  partially_signed: '#a78bfa', signed: '#4ade80', declined: '#f87171',
  void: '#6b7280', expired: '#f59e0b',
};

const CATEGORY_COLORS = {
  contracts: { color: '#ffb84d', bg: 'rgba(255,184,77,0.12)', border: 'rgba(255,184,77,0.3)' },
  finance:   { color: '#4ade80', bg: 'rgba(74,222,128,0.10)', border: 'rgba(74,222,128,0.3)' },
  sops:      { color: '#a78bfa', bg: 'rgba(167,139,250,0.10)', border: 'rgba(167,139,250,0.3)' },
  vendor:    { color: '#60a5fa', bg: 'rgba(96,165,250,0.10)', border: 'rgba(96,165,250,0.3)' },
  marketing: { color: '#f472b6', bg: 'rgba(244,114,182,0.10)', border: 'rgba(244,114,182,0.3)' },
  team:      { color: '#fbbf24', bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.3)' },
  other:     { color: '#8a8a8a', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.10)' },
};

export default function DocumentsClient({ initialDocuments, initialError, events, categories, filters }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [documents, setDocuments] = useState(initialDocuments);
  const [error, setError] = useState(initialError);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Upload form state
  const [f, setF] = useState({
    title: '', description: '', category: 'contracts', counterparty: '',
    event_id: '', tags: '', file: null,
  });

  function setFilter(key, value) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    router.push(`/admin/documents?${params.toString()}`);
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!f.file) return setError('Pick a file first.');
    setUploading(true); setError(null);
    const fd = new FormData();
    fd.append('title', f.title);
    fd.append('description', f.description);
    fd.append('category', f.category);
    fd.append('counterparty', f.counterparty);
    fd.append('event_id', f.event_id);
    fd.append('tags', f.tags);
    fd.append('file', f.file);
    try {
      const res = await fetch('/api/admin/documents', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed');
      setShowUpload(false);
      setF({ title: '', description: '', category: 'contracts', counterparty: '', event_id: '', tags: '', file: null });
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id, title) {
    if (!confirm(`Delete "${title}"? This permanently removes all versions and files.`)) return;
    const res = await fetch(`/api/admin/documents/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setError(j.error || 'Delete failed');
    }
    setDocuments(documents.filter((d) => d.id !== id));
  }

  return (
    <>
      {/* Toolbar — search + status + upload */}
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <input
          type="search"
          placeholder="Search title, counterparty, description…"
          defaultValue={filters.q}
          onKeyDown={(e) => { if (e.key === 'Enter') setFilter('q', e.currentTarget.value); }}
          className="flex-1 min-w-[240px] px-4 py-2.5 text-[14px] rounded-[10px] outline-none focus:border-white/30"
          style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)', color: 'white' }}
        />
        <select
          value={filters.status || 'active'}
          onChange={(e) => setFilter('status', e.target.value)}
          className="px-3 py-2.5 text-[14px] rounded-[10px] outline-none cursor-pointer"
          style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)', color: 'white' }}
        >
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
        <button
          onClick={() => setShowUpload(true)}
          className="px-5 py-2.5 text-[13px] font-semibold rounded-[10px] tracking-[0.06em] uppercase"
          style={{ background: 'white', color: 'black' }}
        >
          + Upload
        </button>
      </div>

      {/* Category tabs */}
      <div
        className="flex flex-wrap gap-x-1 gap-y-0 mb-6 overflow-x-auto"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        role="tablist"
        aria-label="Document categories"
      >
        {[{ value: '', label: 'All' }, ...categories].map((c) => {
          const isActive = (filters.category || '') === c.value;
          return (
            <button
              key={c.value || 'all'}
              role="tab"
              aria-selected={isActive}
              onClick={() => setFilter('category', c.value)}
              className="px-4 py-3 text-[13px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap transition-colors"
              style={{
                color: isActive ? 'white' : '#8a8a8a',
                borderBottom: isActive ? '2px solid white' : '2px solid transparent',
                marginBottom: '-1px',
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-[10px] text-[13px]" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>
          {error}
        </div>
      )}

      {/* List */}
      {documents.length === 0 ? (
        <div className="rounded-[14px] border p-12 text-center" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}>
          <p style={{ color: '#8a8a8a' }}>No documents yet. Click Upload to add the first one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((d) => {
            const cat = CATEGORY_COLORS[d.category] || CATEGORY_COLORS.other;
            const ver = d.document_versions;
            const tags = (d.document_tags || []).map((t) => t.tag);
            const contractStatus = Array.isArray(d.document_contracts)
              ? d.document_contracts[0]?.status
              : d.document_contracts?.status;
            return (
              <div
                key={d.id}
                className="rounded-[12px] border p-4 flex items-start gap-4 hover:border-white/20 transition-colors"
                style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <Link href={`/admin/documents/${d.id}`} className="text-[15px] font-semibold hover:underline truncate">
                      {d.title}
                    </Link>
                    <span
                      className="text-[10px] font-semibold tracking-[0.10em] uppercase px-2 py-0.5 rounded-[6px]"
                      style={{ background: cat.bg, color: cat.color, border: `1px solid ${cat.border}` }}
                    >
                      {d.category}
                    </span>
                    {d.status !== 'active' && (
                      <span className="text-[10px] tracking-[0.10em] uppercase px-2 py-0.5 rounded-[6px]" style={{ background: 'rgba(255,255,255,0.05)', color: '#8a8a8a' }}>
                        {d.status}
                      </span>
                    )}
                    {contractStatus && (
                      <span
                        className="text-[10px] tracking-[0.10em] uppercase px-2 py-0.5 rounded-[6px] font-semibold"
                        style={{
                          background: `${CONTRACT_STATUS_COLOR[contractStatus] || '#8a8a8a'}22`,
                          color: CONTRACT_STATUS_COLOR[contractStatus] || '#8a8a8a',
                        }}
                      >
                        {contractStatus.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] flex flex-wrap gap-x-3 gap-y-1" style={{ color: '#8a8a8a' }}>
                    {d.counterparty && <span>{d.counterparty}</span>}
                    {d.events && <span>· Event: {d.events.title}</span>}
                    {ver && <span>· v{ver.version_number} · {ver.filename} · {formatBytes(ver.size_bytes)}</span>}
                    <span>· Updated {formatDate(d.updated_at)}</span>
                  </div>
                  {tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tags.map((t) => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-[4px]" style={{ background: 'rgba(255,255,255,0.05)', color: '#a8a8a8' }}>
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <a
                    href={`/api/admin/documents/${d.id}/download?inline=1`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] px-3 py-1.5 rounded-[8px] hover:bg-white/10"
                    style={{ border: '1px solid rgba(255,255,255,0.10)', color: 'white' }}
                  >
                    View
                  </a>
                  <a
                    href={`/api/admin/documents/${d.id}/download`}
                    className="text-[12px] px-3 py-1.5 rounded-[8px] hover:bg-white/10"
                    style={{ border: '1px solid rgba(255,255,255,0.10)', color: 'white' }}
                  >
                    Download
                  </a>
                  <button
                    onClick={() => handleDelete(d.id, d.title)}
                    className="text-[12px] px-3 py-1.5 rounded-[8px] hover:bg-red-500/10"
                    style={{ border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload modal */}
      {showUpload && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => !uploading && setShowUpload(false)}
        >
          <form
            onSubmit={handleUpload}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[520px] rounded-[14px] border p-6 space-y-3"
            style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.10)' }}
          >
            <h2 className="text-[20px] font-bold mb-1">Upload document</h2>
            <p className="text-[12px] mb-4" style={{ color: '#8a8a8a' }}>
              File is stored in a private bucket. Only admins can access it. All actions are logged.
            </p>
            <input
              required
              placeholder="Title (e.g. Vendor Agreement — Roastery Co)"
              value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })}
              className="w-full px-3 py-2.5 text-[14px] rounded-[10px] outline-none"
              style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.08)', color: 'white' }}
            />
            <div className="grid grid-cols-2 gap-3">
              <select
                value={f.category}
                onChange={(e) => setF({ ...f, category: e.target.value })}
                className="px-3 py-2.5 text-[14px] rounded-[10px] outline-none cursor-pointer"
                style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.08)', color: 'white' }}
              >
                {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <input
                placeholder="Counterparty (optional)"
                value={f.counterparty}
                onChange={(e) => setF({ ...f, counterparty: e.target.value })}
                className="px-3 py-2.5 text-[14px] rounded-[10px] outline-none"
                style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.08)', color: 'white' }}
              />
            </div>
            <select
              value={f.event_id}
              onChange={(e) => setF({ ...f, event_id: e.target.value })}
              className="w-full px-3 py-2.5 text-[14px] rounded-[10px] outline-none cursor-pointer"
              style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.08)', color: 'white' }}
            >
              <option value="">No event link</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.title} {ev.event_date ? `· ${ev.event_date}` : ''}
                </option>
              ))}
            </select>
            <input
              placeholder="Tags (comma-separated)"
              value={f.tags}
              onChange={(e) => setF({ ...f, tags: e.target.value })}
              className="w-full px-3 py-2.5 text-[14px] rounded-[10px] outline-none"
              style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.08)', color: 'white' }}
            />
            <textarea
              placeholder="Notes / description (optional)"
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2.5 text-[14px] rounded-[10px] outline-none resize-none"
              style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.08)', color: 'white' }}
            />
            <input
              required
              type="file"
              onChange={(e) => setF({ ...f, file: e.target.files?.[0] || null })}
              className="w-full text-[13px]"
              style={{ color: '#a8a8a8' }}
            />
            <p className="text-[11px]" style={{ color: '#666' }}>
              Max 100 MB. PDF, Office docs, images, CSV, ZIP.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowUpload(false)}
                disabled={uploading}
                className="px-4 py-2 text-[13px] rounded-[10px]"
                style={{ border: '1px solid rgba(255,255,255,0.10)', color: 'white' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={uploading}
                className="px-5 py-2 text-[13px] font-semibold rounded-[10px] tracking-[0.06em] uppercase"
                style={{ background: 'white', color: 'black', opacity: uploading ? 0.6 : 1 }}
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
