'use client';

import { useState } from 'react';
import { DEPARTMENTS, STATUSES, PRIORITIES } from '@/lib/progress';

async function apiJson(url, options) {
  const res = await fetch(url, options);
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  if (res.status === 401 && json?.reason === 'mfa_required' && typeof window !== 'undefined') {
    window.location.href = '/bananas/security?mfa=required';
    throw new Error('MFA required');
  }
  if (!res.ok) throw new Error(json?.error || 'Request failed');
  return json;
}

const inputStyle = {
  background: '#0a0a0a', border: '1px solid var(--fg-a1)', color: 'var(--text-1)',
};

// Admin create/edit form. `task` present => edit (PATCH), absent => create
// (POST). Assignees come from the server (team_members).
export default function TaskFormModal({ task, assignees = [], onClose, onSaved }) {
  const editing = Boolean(task);
  const [form, setForm] = useState({
    title: task?.title || '',
    department: task?.department || DEPARTMENTS[0].slug,
    description: task?.description || '',
    assignee_id: task?.assignee_id || '',
    status: task?.status || 'not_started',
    priority: task?.priority || 'medium',
    due_date: task?.due_date || '',
    update_cadence_days: task?.update_cadence_days ?? '',
    next_update_due: task?.next_update_due || '',
    percent_complete: task?.percent_complete ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required.'); return; }
    setSaving(true);
    setError('');
    const payload = {
      title: form.title.trim(),
      department: form.department,
      description: form.description.trim() || null,
      assignee_id: form.assignee_id || null,
      status: form.status,
      priority: form.priority,
      due_date: form.due_date || null,
      update_cadence_days: form.update_cadence_days === '' ? null : Number(form.update_cadence_days),
      next_update_due: form.next_update_due || null,
      percent_complete: Number(form.percent_complete) || 0,
    };
    try {
      const json = await apiJson(
        editing ? `/api/progress/tasks/${task.id}` : '/api/progress/tasks',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      onSaved?.(json.task);
      onClose?.();
    } catch (e2) {
      setError(e2.message);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/70" style={{ border: 'none', cursor: 'pointer' }} />
      <form onSubmit={submit}
        className="relative w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-[16px] p-6"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--fg-a1)' }}>
        <h2 className="text-[22px] font-extrabold mb-5" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          {editing ? 'Edit task' : 'New task'}
        </h2>

        {error && (
          <div className="rounded-lg px-4 py-3 mb-4 text-[13px]" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--st-fca5a5)' }} role="alert">{error}</div>
        )}

        <div className="space-y-4">
          <Labeled label="Deliverable / title">
            <input value={form.title} onChange={set('title')} required
              className="w-full rounded-lg px-3 py-2.5 text-[14px]" style={inputStyle} />
          </Labeled>

          <div className="grid grid-cols-2 gap-4">
            <Labeled label="Department">
              <select value={form.department} onChange={set('department')} className="w-full rounded-lg px-3 py-2.5 text-[14px]" style={inputStyle}>
                {DEPARTMENTS.map((d) => <option key={d.slug} value={d.slug}>{d.label}</option>)}
              </select>
            </Labeled>
            <Labeled label="Assignee">
              <select value={form.assignee_id} onChange={set('assignee_id')} className="w-full rounded-lg px-3 py-2.5 text-[14px]" style={inputStyle}>
                <option value="">Unassigned</option>
                {assignees.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </Labeled>
          </div>

          <Labeled label="Details">
            <textarea value={form.description} onChange={set('description')} rows={3}
              className="w-full rounded-lg px-3 py-2.5 text-[14px] resize-y" style={inputStyle} />
          </Labeled>

          <div className="grid grid-cols-2 gap-4">
            <Labeled label="Status">
              <select value={form.status} onChange={set('status')} className="w-full rounded-lg px-3 py-2.5 text-[14px]" style={inputStyle}>
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Labeled>
            <Labeled label="Priority">
              <select value={form.priority} onChange={set('priority')} className="w-full rounded-lg px-3 py-2.5 text-[14px]" style={inputStyle}>
                {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </Labeled>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Labeled label="Due date">
              <input type="date" value={form.due_date} onChange={set('due_date')} className="w-full rounded-lg px-3 py-2.5 text-[14px]" style={inputStyle} />
            </Labeled>
            <Labeled label="Percent complete">
              <input type="number" min={0} max={100} value={form.percent_complete} onChange={set('percent_complete')} className="w-full rounded-lg px-3 py-2.5 text-[14px]" style={inputStyle} />
            </Labeled>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Labeled label="Update cadence (days)">
              <input type="number" min={1} max={365} value={form.update_cadence_days} onChange={set('update_cadence_days')} placeholder="e.g. 7" className="w-full rounded-lg px-3 py-2.5 text-[14px]" style={inputStyle} />
            </Labeled>
            <Labeled label="Next update due">
              <input type="date" value={form.next_update_due} onChange={set('next_update_due')} className="w-full rounded-lg px-3 py-2.5 text-[14px]" style={inputStyle} />
            </Labeled>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button type="button" onClick={onClose}
            className="px-5 py-3 rounded-full text-[12px] font-semibold tracking-[0.1em] hover:bg-white/5"
            style={{ minHeight: '44px', border: '1px solid var(--fg-a15)', color: 'var(--text-3)', cursor: 'pointer' }}>
            CANCEL
          </button>
          <button type="submit" disabled={saving}
            className="px-6 py-3 rounded-full text-[12px] font-semibold tracking-[0.1em] disabled:opacity-40"
            style={{ minHeight: '44px', background: 'var(--st-ffb84d)', color: '#0a0a0a', border: 'none', cursor: 'pointer' }}>
            {saving ? 'SAVING…' : editing ? 'SAVE CHANGES' : 'CREATE TASK'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Labeled({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold tracking-[0.12em] mb-1.5" style={{ color: 'var(--text-3)' }}>{label.toUpperCase()}</span>
      {children}
    </label>
  );
}
