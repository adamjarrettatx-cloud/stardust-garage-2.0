'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import { businessFields, referencedSignerSlots, roleLabel } from '@/lib/contract-fields';
import FieldEditor from '../FieldEditor';

const inputStyle = { background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.08)', color: 'white' };

// Per-contract field layout editor + business-value fill form. The layout is a
// COPY cloned from the template (or empty for one-off docs) and is independently
// editable per Adam's requirement that recipient-fillable fields vary per send.
// Business (staff-filled) values are baked into the PDF at send time; signer_N
// fields become interactive SignNow fields. See lib/contract-fields.js.
export default function ContractFieldsPanel({ documentId, initialContract }) {
  const router = useRouter();
  const [layout, setLayout] = useState(Array.isArray(initialContract?.field_layout) ? initialContract.field_layout : []);
  const [values, setValues] = useState(
    initialContract?.field_values && typeof initialContract.field_values === 'object' ? initialContract.field_values : {},
  );
  const [showEditor, setShowEditor] = useState(false);
  const [savingFields, setSavingFields] = useState(false);
  const [savingValues, setSavingValues] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const bizFields = useMemo(() => businessFields(layout), [layout]);
  const signerSlots = useMemo(() => referencedSignerSlots(layout), [layout]);

  async function saveLayout(next) {
    setSavingFields(true); setError(null); setNotice(null);
    try {
      const json = await adminFetch(`/api/admin/documents/${documentId}/contract/fields`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field_layout: next }),
      });
      setLayout(Array.isArray(json.contract?.field_layout) ? json.contract.field_layout : next);
      setValues(json.contract?.field_values || {});
      setNotice(`Saved ${next.length} field${next.length === 1 ? '' : 's'}.`);
      router.refresh();
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSavingFields(false);
    }
  }

  async function saveValues() {
    setSavingValues(true); setError(null); setNotice(null);
    try {
      const json = await adminFetch(`/api/admin/documents/${documentId}/contract/fields`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field_values: values }),
      });
      setValues(json.contract?.field_values || values);
      setNotice('Business field values saved.');
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingValues(false);
    }
  }

  function setValue(id, v) {
    setValues((prev) => ({ ...prev, [id]: v }));
  }

  return (
    <div className="rounded-[14px] border p-5 mb-6" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase" style={{ color: '#8a8a8a' }}>
          Fields &amp; content
        </h2>
        <button onClick={() => setShowEditor((s) => !s)}
          className="text-[12px] px-3 py-1.5 rounded-[8px]" style={{ border: '1px solid rgba(255,255,255,0.10)', color: 'white' }}>
          {showEditor ? 'Hide field editor' : 'Edit fields on PDF'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-[10px] text-[13px]" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>{error}</div>
      )}
      {notice && (
        <div className="mb-4 p-3 rounded-[10px] text-[13px]" style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', color: '#86efac' }}>{notice}</div>
      )}

      <p className="text-[13px] mb-4" style={{ color: '#8a8a8a' }}>
        {layout.length === 0
          ? 'No fields placed yet. Use “Edit fields on PDF” to add business (staff-filled) or signer fields.'
          : `${layout.length} field${layout.length === 1 ? '' : 's'} placed · ${bizFields.length} business · ${signerSlots.length} signer slot${signerSlots.length === 1 ? '' : 's'} referenced${signerSlots.length ? ` (${signerSlots.map((n) => `Signer ${n}`).join(', ')})` : ''}.`}
      </p>

      {/* Business-fill form */}
      {bizFields.length > 0 && (
        <div className="mb-4">
          <div className="text-[12px] mb-2" style={{ color: '#8a8a8a' }}>
            Business values <span style={{ color: '#6a6a6a' }}>(baked into the PDF before sending)</span>
          </div>
          <div className="space-y-2">
            {bizFields.map((f) => (
              <div key={f.id} className="grid grid-cols-[1fr_1.4fr] gap-3 items-center">
                <label className="text-[13px] truncate" title={f.label}>
                  {f.label || roleLabel(f.assigned_to)}
                  {f.required !== false && <span style={{ color: '#fbbf24' }}> *</span>}
                </label>
                {f.type === 'checkbox' ? (
                  <input type="checkbox" checked={values[f.id] === true || values[f.id] === 'true'}
                    onChange={(e) => setValue(f.id, e.target.checked)} />
                ) : (
                  <input value={values[f.id] ?? ''} onChange={(e) => setValue(f.id, e.target.value)}
                    className="px-3 py-2 text-[13px] rounded-[8px] outline-none" style={inputStyle} />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-3">
            <button onClick={saveValues} disabled={savingValues}
              className="px-4 py-2 text-[13px] font-semibold rounded-[10px] tracking-[0.06em] uppercase"
              style={{ background: 'white', color: 'black', opacity: savingValues ? 0.6 : 1 }}>
              {savingValues ? 'Saving…' : 'Save values'}
            </button>
          </div>
        </div>
      )}

      {/* Visual editor */}
      {showEditor && (
        <div className="pt-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <FieldEditor
            fileUrl={`/api/admin/documents/${documentId}/download?inline=1`}
            initialLayout={layout}
            onSave={saveLayout}
            saving={savingFields}
            saveLabel="Save field layout"
          />
        </div>
      )}
    </div>
  );
}
