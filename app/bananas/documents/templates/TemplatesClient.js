'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFetch } from '@/lib/admin-fetch';
import { DOCUMENTS_THEMES as THEMES } from '@/lib/admin-theme';
import { useAuthenticatedTheme } from '@/app/components/AuthenticatedThemeProvider';
import { TEMPLATE_KINDS, templateKindLabel } from '@/lib/event-organizer';

export default function TemplatesClient({ categories }) {
  const { theme } = useAuthenticatedTheme();
  const t = THEMES[theme];
  const inputStyle = { background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.inputText };
  const ghostButtonStyle = { border: `1px solid ${t.ghostBorder}`, color: t.ghostText };
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [showInactive, setShowInactive] = useState(false);

  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'contracts',
    kind: 'other',
    requires_master: false,
  });
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
      fd.append('kind', form.kind);
      // requires_master is only meaningful for event agreements; the API rejects
      // the combination otherwise, so don't send a stale true from a kind switch.
      fd.append('requires_master', String(form.kind === 'event' && form.requires_master));
      fd.append('file', file);
      const json = await adminFetch('/api/admin/templates', { method: 'POST', body: fd });
      setNotice(`Template “${json.template.title}” uploaded. Open it to place fields.`);
      setForm({ title: '', description: '', category: 'contracts', kind: 'other', requires_master: false });
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
        <div className="mb-4 p-3 rounded-[10px] text-[13px]" style={{ background: t.dangerBg, border: `1px solid ${t.dangerBorder}`, color: t.dangerText }}>{error}</div>
      )}
      {notice && (
        <div className="mb-4 p-3 rounded-[10px] text-[13px]" style={{ background: t.successBg, border: `1px solid ${t.successBorder}`, color: t.successText }}>{notice}</div>
      )}

      {/* Upload */}
      <form onSubmit={upload} className="rounded-[14px] border p-5 mb-8" style={{ background: t.cardBg, borderColor: t.cardBorder }}>
        <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase mb-4" style={{ color: t.muted }}>New template</h2>
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
        {/* KIND — what role this template plays in the profile-first flow. Only
            'event' templates can be created from an event's Contracts panel with a
            Master Agreement reference. */}
        <div className="grid grid-cols-2 gap-3 mb-3 items-center">
          <select value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value, requires_master: e.target.value === 'event' ? form.requires_master : false })}
            className="px-3 py-2.5 text-[14px] rounded-[10px] outline-none cursor-pointer" style={inputStyle}>
            {TEMPLATE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          {form.kind === 'event' && (
            <label className="flex items-center gap-2 text-[13px]" style={{ color: t.mutedStrong }}>
              <input type="checkbox" checked={form.requires_master}
                onChange={(e) => setForm({ ...form, requires_master: e.target.checked })} />
              Requires a signed Master Agreement
            </label>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="text-[13px]" style={{ color: t.mutedStrong }} />
          <button type="submit" disabled={uploading || !form.title}
            className="px-5 py-2 text-[13px] font-semibold rounded-[10px] tracking-[0.06em] uppercase"
            style={{ background: t.solidBg, color: t.solidText, opacity: uploading || !form.title ? 0.6 : 1 }}>
            {uploading ? 'Uploading…' : 'Upload template'}
          </button>
        </div>
        <p className="text-[11px] mt-2" style={{ color: t.faint }}>PDF only. Field coordinates are placed against the rendered PDF.</p>
      </form>

      {/* List */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase" style={{ color: t.muted }}>
          Templates ({templates.length})
        </h2>
        <label className="text-[12px] flex items-center gap-2" style={{ color: t.muted }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      {loading ? (
        <p className="text-[13px]" style={{ color: t.muted }}>Loading…</p>
      ) : templates.length === 0 ? (
        <p className="text-[13px]" style={{ color: t.muted }}>No templates yet. Upload one above.</p>
      ) : (
        <div className="space-y-2">
          {templates.map((tpl) => (
            <div key={tpl.id} className="rounded-[10px] border p-3 flex items-center gap-3"
              style={{ background: t.cardBg, borderColor: t.cardBorder, opacity: tpl.is_active ? 1 : 0.6 }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[14px] font-semibold truncate">{tpl.title}</span>
                  {!tpl.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded-[4px]" style={{ background: t.chipBg, color: t.muted }}>INACTIVE</span>}
                </div>
                <div className="text-[11px]" style={{ color: t.muted }}>
                  {templateKindLabel(tpl.kind)} · {tpl.category} · {tpl.page_count || '?'} page{tpl.page_count === 1 ? '' : 's'} · {tpl.field_count} field{tpl.field_count === 1 ? '' : 's'}{tpl.requires_master ? ' · needs Master Agreement' : ''} · {tpl.filename}
                </div>
              </div>
              <Link href={`/bananas/documents/templates/${tpl.id}`}
                className="text-[12px] px-3 py-1.5 rounded-[8px]" style={ghostButtonStyle}>
                Edit fields
              </Link>
              <button onClick={() => toggleActive(tpl)}
                className="text-[12px] px-3 py-1.5 rounded-[8px]" style={ghostButtonStyle}>
                {tpl.is_active ? 'Deactivate' : 'Activate'}
              </button>
              <button onClick={() => remove(tpl)}
                className="text-[12px] px-3 py-1.5 rounded-[8px]" style={{ border: `1px solid ${t.dangerBorder}`, color: t.dangerText }}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
