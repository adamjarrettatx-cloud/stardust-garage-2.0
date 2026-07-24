'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFetch } from '@/lib/admin-fetch';

const inputStyle = { background: 'var(--surface-3)', border: '1px solid var(--fg-a08)', color: 'white' };

export default function TemplatesClient({ categories }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [showInactive, setShowInactive] = useState(false);

  const [form, setForm] = useState({ title: '', description: '', category: 'contracts' });
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const json = await adminFetch(`/api/admin/templates${showInactive ? '?include=inactive' : ''}`);
      setTemplates(json.templates || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInactive]);

  async function upload(e) {
    e.preventDefault();
    if (!file) { setError('Choose a PDF file first.'); return; }
    if (file.type !== 'application/pdf') { setError('Templates must be PDF files.'); return; }
    setUploading(true); setError(null); setNotice(null);
    try {
      const fd = new FormData();
      fd.append('title', form.title);
      fd.append('description', form.description);
      fd.append('category', form.category);
      fd.append('file', file);
      const json = await adminFetch('/api/admin/templates', { method: 'POST', body: fd });
      setNotice(`Template “${json.template.title}” uploaded. Open it to place fields.`);
      setForm({ title: '', description: '', category: 'contracts' });
      setFile(null);
      e.target.reset?.();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function toggleActive(t) {
    setError(null); setNotice(null);
    try {
      await adminFetch(`/api/admin/templates/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !t.is_active }),
      });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(t) {
    if (!window.confirm(`Delete template “${t.title}”? Contracts already created from it are unaffected.`)) return;
    setError(null); setNotice(null);
    try {
      await adminFetch(`/api/admin/templates/${t.id}`, { method: 'DELETE' });
      setNotice(`Template “${t.title}” deleted.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      {error && (
        <div className="mb-4 p-3 rounded-[10px] text-[13px]" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--st-fca5a5)' }}>{error}</div>
      )}
      {notice && (
        <div className="mb-4 p-3 rounded-[10px] text-[13px]" style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', color: 'var(--st-86efac)' }}>{notice}</div>
      )}

      {/* Upload */}
      <form onSubmit={upload} className="rounded-[14px] border p-5 mb-8" style={{ background: 'var(--surface-1)', borderColor: 'var(--fg-a06)' }}>
        <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase mb-4" style={{ color: 'var(--text-3)' }}>New template</h2>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="px-3 py-2.5 text-[14px] rounded-[10px] outline-none" style={inputStyle} />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="px-3 py-2.5 text-[14px] rounded-[10px] outline-none cursor-pointer" style={inputStyle}>
            {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <input placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full px-3 py-2.5 text-[14px] rounded-[10px] outline-none mb-3" style={inputStyle} />
        <div className="flex items-center justify-between gap-3">
          <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="text-[13px]" style={{ color: 'var(--text-2)' }} />
          <button type="submit" disabled={uploading || !form.title}
            className="px-5 py-2 text-[13px] font-semibold rounded-[10px] tracking-[0.06em] uppercase"
            style={{ background: 'white', color: 'black', opacity: uploading || !form.title ? 0.6 : 1 }}>
            {uploading ? 'Uploading…' : 'Upload template'}
          </button>
        </div>
        <p className="text-[11px] mt-2" style={{ color: 'var(--text-4)' }}>PDF only. Field coordinates are placed against the rendered PDF.</p>
      </form>

      {/* List */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase" style={{ color: 'var(--text-3)' }}>
          Templates ({templates.length})
        </h2>
        <label className="text-[12px] flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      {loading ? (
        <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>Loading…</p>
      ) : templates.length === 0 ? (
        <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>No templates yet. Upload one above.</p>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="rounded-[10px] border p-3 flex items-center gap-3"
              style={{ background: 'var(--surface-1)', borderColor: t.is_active ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)', opacity: t.is_active ? 1 : 0.6 }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[14px] font-semibold truncate">{t.title}</span>
                  {!t.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded-[4px]" style={{ background: 'var(--fg-a06)', color: 'var(--text-3)' }}>INACTIVE</span>}
                </div>
                <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  {t.category} · {t.page_count || '?'} page{t.page_count === 1 ? '' : 's'} · {t.field_count} field{t.field_count === 1 ? '' : 's'} · {t.filename}
                </div>
              </div>
              <Link href={`/bananas/documents/templates/${t.id}`}
                className="text-[12px] px-3 py-1.5 rounded-[8px]" style={{ border: '1px solid var(--fg-a1)', color: 'white' }}>
                Edit fields
              </Link>
              <button onClick={() => toggleActive(t)}
                className="text-[12px] px-3 py-1.5 rounded-[8px]" style={{ border: '1px solid var(--fg-a1)', color: 'white' }}>
                {t.is_active ? 'Deactivate' : 'Activate'}
              </button>
              <button onClick={() => remove(t)}
                className="text-[12px] px-3 py-1.5 rounded-[8px]" style={{ border: '1px solid rgba(239,68,68,0.3)', color: 'var(--st-fca5a5)' }}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
