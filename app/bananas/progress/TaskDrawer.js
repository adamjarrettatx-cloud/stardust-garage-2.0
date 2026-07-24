'use client';

import { useState, useEffect, useCallback } from 'react';
import { STATUSES } from '@/lib/progress';
import {
  StatusBadge, PriorityBadge, DeptChip, formatDate, formatDateTime,
} from './ui';

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

const ACTION_LABELS = {
  created: 'created the task',
  status_changed: 'changed status',
  assigned: 'reassigned',
  reprioritized: 'changed priority',
  due_changed: 'changed the due date',
  cadence_changed: 'changed the update cadence',
  percent_changed: 'updated percent complete',
  archived: 'archived the task',
  unarchived: 'unarchived the task',
  completed: 'marked it complete',
  update_posted: 'posted an update',
  edited: 'edited the task',
};

// Shared task detail drawer. `canManage` unlocks the admin quick actions
// (complete/archive/edit); `canDelete` unlocks owner hard delete; every team
// member with access can post updates. Used by both the admin dashboard and the
// team page, so authorization is driven by props the server set, never by the
// drawer trusting the client.
export default function TaskDrawer({
  task, assignees = [], canManage = false, canDelete = false, onClose, onChanged, onEdit,
}) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [body, setBody] = useState('');
  const [statusChange, setStatusChange] = useState('');
  const [percentChange, setPercentChange] = useState('');
  const [posting, setPosting] = useState(false);
  const [busy, setBusy] = useState(false);

  const assigneeName = useCallback(
    (id) => assignees.find((a) => a.id === id)?.label || (id ? 'Unknown' : 'Unassigned'),
    [assignees],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const json = await apiJson(`/api/progress/tasks/${task.id}`);
      setDetail(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [task.id]);

  useEffect(() => { load(); }, [load]);

  const current = detail?.task || task;

  async function postUpdate(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setPosting(true);
    setError('');
    try {
      await apiJson(`/api/progress/tasks/${task.id}/updates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: body.trim(),
          status: statusChange || null,
          percent: percentChange === '' ? null : Number(percentChange),
        }),
      });
      setBody('');
      setStatusChange('');
      setPercentChange('');
      await load();
      onChanged?.();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setPosting(false);
    }
  }

  async function patch(patchBody) {
    setBusy(true);
    setError('');
    try {
      await apiJson(`/api/progress/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      });
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function hardDelete() {
    if (!window.confirm('Permanently delete this task and its history? This cannot be undone.')) return;
    setBusy(true);
    setError('');
    try {
      await apiJson(`/api/progress/tasks/${task.id}`, { method: 'DELETE' });
      onChanged?.();
      onClose?.();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Task detail">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
        style={{ border: 'none', cursor: 'pointer' }}
      />
      <div
        className="relative w-full max-w-[560px] h-full overflow-y-auto"
        style={{ background: 'var(--surface-2)', borderLeft: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-6 py-5"
          style={{ background: 'var(--surface-2)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <DeptChip slug={current.department} />
              <PriorityBadge value={current.priority} />
              {current.archived && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: 'var(--fg-a08)', color: 'var(--text-3)' }}>ARCHIVED</span>
              )}
            </div>
            <h2 className="text-[20px] font-extrabold leading-tight break-words"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {current.title}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-[20px] hover:bg-white/5"
            style={{ border: '1px solid var(--fg-a12)', color: 'var(--text-3)' }}>×</button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {error && (
            <div className="rounded-lg px-4 py-3 text-[13px]" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--st-fca5a5)' }} role="alert">
              {error}
            </div>
          )}

          {/* Summary grid */}
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <Field label="Status"><StatusBadge value={current.status} /></Field>
            <Field label="Assignee">{assigneeName(current.assignee_id)}</Field>
            <Field label="Due">{formatDate(current.due_date)}</Field>
            <Field label="Next update due">{formatDate(current.next_update_due)}</Field>
            <Field label="Cadence">{current.update_cadence_days ? `Every ${current.update_cadence_days}d` : '—'}</Field>
            <Field label="Percent">{current.percent_complete}%</Field>
          </div>

          {current.description && (
            <div>
              <div className="text-[11px] font-semibold tracking-[0.12em] mb-1.5" style={{ color: 'var(--text-3)' }}>DETAILS</div>
              <p className="text-[14px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-2)' }}>{current.description}</p>
            </div>
          )}

          {/* Admin quick actions */}
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {current.status !== 'done' && (
                <ActionBtn onClick={() => patch({ status: 'done' })} disabled={busy}>Mark complete</ActionBtn>
              )}
              <ActionBtn onClick={() => patch({ archived: !current.archived })} disabled={busy}>
                {current.archived ? 'Unarchive' : 'Archive'}
              </ActionBtn>
              {onEdit && <ActionBtn onClick={() => onEdit(current)} disabled={busy}>Edit</ActionBtn>}
              {canDelete && (
                <ActionBtn onClick={hardDelete} disabled={busy} danger>Delete</ActionBtn>
              )}
            </div>
          )}

          {/* Post update — the primary action */}
          <form onSubmit={postUpdate} className="rounded-[14px] p-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--fg-a06)' }}>
            <div className="text-[11px] font-semibold tracking-[0.12em] mb-2" style={{ color: 'var(--st-ffb84d)' }}>POST UPDATE</div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="What progress did you make? What's blocking you?"
              className="w-full rounded-lg px-3 py-2.5 text-[14px] resize-y"
              style={{ background: '#0a0a0a', border: '1px solid var(--fg-a1)', color: 'var(--text-1)' }}
            />
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <label className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                Status
                <select value={statusChange} onChange={(e) => setStatusChange(e.target.value)}
                  className="ml-2 rounded-md px-2 py-1.5 text-[12px]"
                  style={{ background: '#0a0a0a', border: '1px solid var(--fg-a1)', color: 'var(--text-1)' }}>
                  <option value="">No change</option>
                  {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
              <label className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                %
                <input type="number" min={0} max={100} value={percentChange}
                  onChange={(e) => setPercentChange(e.target.value)} placeholder="—"
                  className="ml-2 w-16 rounded-md px-2 py-1.5 text-[12px]"
                  style={{ background: '#0a0a0a', border: '1px solid var(--fg-a1)', color: 'var(--text-1)' }} />
              </label>
              <button type="submit" disabled={posting || !body.trim()}
                className="ml-auto px-5 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.1em] disabled:opacity-40"
                style={{ background: 'var(--st-ffb84d)', color: '#0a0a0a', border: 'none', cursor: 'pointer', minHeight: '44px' }}>
                {posting ? 'POSTING…' : 'POST'}
              </button>
            </div>
          </form>

          {/* Thread */}
          <div>
            <div className="text-[11px] font-semibold tracking-[0.12em] mb-3" style={{ color: 'var(--text-3)' }}>UPDATES</div>
            {loading && <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>Loading…</p>}
            {!loading && detail?.updates?.length === 0 && (
              <p className="text-[13px]" style={{ color: 'var(--text-4)' }}>No updates yet. Be the first to post progress.</p>
            )}
            <ul className="space-y-3">
              {(detail?.updates || []).map((u) => (
                <li key={u.id} className="rounded-lg p-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--fg-a05)' }}>
                  <p className="text-[14px] leading-relaxed whitespace-pre-wrap break-words" style={{ color: 'var(--text-1)' }}>{u.body}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]" style={{ color: 'var(--text-4)' }}>
                    <span>{formatDateTime(u.created_at)}</span>
                    {u.status_to && (
                      <span>· status {u.status_from} → <span style={{ color: 'var(--st-ffb84d)' }}>{u.status_to}</span></span>
                    )}
                    {u.percent_to !== null && u.percent_to !== undefined && (
                      <span>· {u.percent_from}% → {u.percent_to}%</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Activity log */}
          {detail?.activity?.length > 0 && (
            <details>
              <summary className="text-[11px] font-semibold tracking-[0.12em] cursor-pointer" style={{ color: 'var(--text-3)' }}>
                ACTIVITY HISTORY ({detail.activity.length})
              </summary>
              <ul className="mt-3 space-y-2">
                {detail.activity.map((a) => (
                  <li key={a.id} className="text-[12px] flex gap-2" style={{ color: 'var(--text-3)' }}>
                    <span style={{ color: 'var(--text-4)' }}>{formatDateTime(a.created_at)}</span>
                    <span>{describeActivity(a, assigneeName)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function describeActivity(a, assigneeName) {
  const base = ACTION_LABELS[a.action] || a.action;
  const d = a.detail || {};
  if (a.action === 'status_changed') return `${base}: ${d.from} → ${d.to}`;
  if (a.action === 'reprioritized') return `${base}: ${d.from} → ${d.to}`;
  if (a.action === 'assigned') return `${base} to ${assigneeName(d.to)}`;
  if (a.action === 'due_changed') return `${base} to ${d.to || 'none'}`;
  if (a.action === 'percent_changed') return `${base}: ${d.from}% → ${d.to}%`;
  return base;
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[10px] font-semibold tracking-[0.12em] mb-1" style={{ color: 'var(--text-3)' }}>{label.toUpperCase()}</div>
      <div style={{ color: 'var(--text-1)' }}>{children}</div>
    </div>
  );
}

function ActionBtn({ children, onClick, disabled, danger }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="px-4 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.08em] disabled:opacity-40 hover:bg-white/5"
      style={{
        minHeight: '44px',
        background: danger ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.06)',
        color: danger ? 'var(--st-fca5a5)' : 'var(--text-1)',
        border: `1px solid ${danger ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.12)'}`,
        cursor: 'pointer',
      }}>
      {children}
    </button>
  );
}
