'use client';

import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import FieldEditor from '../../FieldEditor';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import { DOCUMENTS_THEMES as THEMES } from '@/lib/admin-theme';
import { useAuthenticatedTheme } from '@/app/components/AuthenticatedThemeProvider';
import { TEMPLATE_KINDS } from '@/lib/event-organizer';

export default function TemplateEditorClient({ templateId, categories }) {
  const { theme } = useAuthenticatedTheme();
  const t = THEMES[theme];
  const inputStyle = { background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.inputText };
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [savingFields, setSavingFields] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [meta, setMeta] = useState({
    title: '',
    description: '',
    category: 'contracts',
    kind: 'other',
    requires_master: false,
  });

  useEffect(() => {
    (async () => {
      try {
        const json = await adminFetch(`/api/admin/templates/${templateId}`);
        setTemplate(json.template);
        setMeta({
          title: json.template.title || '',
          description: json.template.description || '',
          category: json.template.category || 'contracts',
          kind: json.template.kind || 'other',
          requires_master: json.template.requires_master === true,
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
        // requires_master is only valid on event templates; normalize here so the
        // UI can never submit a pair the API has to reject.
        body: JSON.stringify({ ...meta, requires_master: meta.kind === 'event' && meta.requires_master }),
      });
      setTemplate(json.template);
      setNotice('Template details saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingMeta(false);
    }
  }

  if (loading) return <p className="text-[13px]" style={{ color: t.muted }}>Loading template…</p>;
  if (error && !template) return <p className="text-[13px]" style={{ color: t.dangerText }}>{error}</p>;
  if (!template) return null;

  return (
    <>
      <AuthenticatedPageHeader
        backHref="/bananas/documents/templates"
        backLabel="← BACK TO TEMPLATES"
        title={template.title}
        titleClassName="text-[28px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-6"
      />

      {error && (
        <div className="mb-4 p-3 rounded-[10px] text-[13px]" style={{ background: t.dangerBg, border: `1px solid ${t.dangerBorder}`, color: t.dangerText }}>{error}</div>
      )}
      {notice && (
        <div className="mb-4 p-3 rounded-[10px] text-[13px]" style={{ background: t.successBg, border: `1px solid ${t.successBorder}`, color: t.successText }}>{notice}</div>
      )}

      {/* Template metadata */}
      <div className="rounded-[14px] border p-5 mb-6" style={{ background: t.cardBg, borderColor: t.cardBorder }}>
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
        {/* KIND — master vs per-event agreement. Event templates may additionally
            require a signed Master Agreement to exist for the organizer. */}
        <div className="grid grid-cols-2 gap-3 mb-3 items-center">
          <select value={meta.kind}
            onChange={(e) => setMeta({ ...meta, kind: e.target.value, requires_master: e.target.value === 'event' ? meta.requires_master : false })}
            className="px-3 py-2.5 text-[14px] rounded-[10px] outline-none cursor-pointer" style={inputStyle}>
            {TEMPLATE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          {meta.kind === 'event' && (
            <label className="flex items-center gap-2 text-[13px]" style={{ color: t.mutedStrong }}>
              <input type="checkbox" checked={meta.requires_master}
                onChange={(e) => setMeta({ ...meta, requires_master: e.target.checked })} />
              Requires a signed Master Agreement
            </label>
          )}
        </div>
        <div className="flex justify-end">
          <button onClick={saveMeta} disabled={savingMeta}
            className="px-4 py-2 text-[13px] rounded-[10px]" style={{ border: `1px solid ${t.ghostBorder}`, color: t.ghostText, opacity: savingMeta ? 0.6 : 1 }}>
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
