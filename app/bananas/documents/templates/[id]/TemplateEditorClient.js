'use client';

import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import FieldEditor from '../../FieldEditor';

const inputStyle = { background: 'var(--surface-3)', border: '1px solid var(--fg-a08)', color: 'white' };

export default function TemplateEditorClient({ templateId, categories }) {
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [savingFields, setSavingFields] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [meta, setMeta] = useState({ title: '', description: '', category: 'contracts' });

  useEffect(() => {
    (async () => {
      try {
        const json = await adminFetch(`/api/admin/templates/${templateId}`);
        setTemplate(json.template);
        setMeta({
          title: json.template.title || '',
          description: json.template.description || '',
          category: json.template.category || 'contracts',
        });
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [templateId]);

  async function saveFields(layout) {
    setSavingFields(true); setError(null); setNotice(null);
    try {
      const json = await adminFetch(`/api/admin/templates/${templateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field_layout: layout }),
      });
      setTemplate(json.template);
      setNotice(`Saved ${layout.length} field${layout.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSavingFields(false);
    }
  }

  async function saveMeta() {
    setSavingMeta(true); setError(null); setNotice(null);
    try {
      const json = await adminFetch(`/api/admin/templates/${templateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(meta),
      });
      setTemplate(json.template);
      setNotice('Template details saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingMeta(false);
    }
  }

  if (loading) return <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>Loading template…</p>;
  if (error && !template) return <p className="text-[13px]" style={{ color: 'var(--st-fca5a5)' }}>{error}</p>;
  if (!template) return null;

  return (
    <>
      <h1 className="text-[28px] font-extrabold -tracking-[0.02em] leading-[1.15] mb-6" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        {template.title}
      </h1>

      {error && (
        <div className="mb-4 p-3 rounded-[10px] text-[13px]" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--st-fca5a5)' }}>{error}</div>
      )}
      {notice && (
        <div className="mb-4 p-3 rounded-[10px] text-[13px]" style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', color: 'var(--st-86efac)' }}>{notice}</div>
      )}

      {/* Template metadata */}
      <div className="rounded-[14px] border p-5 mb-6" style={{ background: 'var(--surface-1)', borderColor: 'var(--fg-a06)' }}>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })}
            className="px-3 py-2.5 text-[14px] rounded-[10px] outline-none" style={inputStyle} />
          <select value={meta.category} onChange={(e) => setMeta({ ...meta, category: e.target.value })}
            className="px-3 py-2.5 text-[14px] rounded-[10px] outline-none cursor-pointer" style={inputStyle}>
            {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <input placeholder="Description" value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })}
          className="w-full px-3 py-2.5 text-[14px] rounded-[10px] outline-none mb-3" style={inputStyle} />
        <div className="flex justify-end">
          <button onClick={saveMeta} disabled={savingMeta}
            className="px-4 py-2 text-[13px] rounded-[10px]" style={{ border: '1px solid var(--fg-a1)', color: 'white', opacity: savingMeta ? 0.6 : 1 }}>
            {savingMeta ? 'Saving…' : 'Save details'}
          </button>
        </div>
      </div>

      <FieldEditor
        fileUrl={`/api/admin/templates/${templateId}/file`}
        initialLayout={Array.isArray(template.field_layout) ? template.field_layout : []}
        onSave={saveFields}
        saving={savingFields}
        saveLabel="Save field layout"
      />
    </>
  );
}
