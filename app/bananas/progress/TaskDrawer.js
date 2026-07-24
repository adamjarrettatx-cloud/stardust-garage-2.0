'use client';

import { useState, useEffect, useCallback } from 'react';
import { STATUSES } from '@/lib/progress';
import { getProgressDrawerTheme } from '@/lib/progress-drawer-theme';
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
  task, assignees = [], canManage = false, canDelete = false, theme = 'dark', onClose, onChanged, onEdit,
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
  const t = getProgressDrawerTheme(theme);

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
    <div
      className="progress-drawer fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Task detail"
      style={{
        '--progress-drawer-text': t.text,
        '--progress-drawer-hover-bg': t.hoverBg,
        '--progress-drawer-placeholder': t.inputPlaceholder,
        '--progress-drawer-focus-border': t.focusBorder,
        '--progress-drawer-focus-ring': t.focusRing,
      }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
        style={{ border: 'none', cursor: 'pointer' }}
      />
      <div
        className="progress-drawer-panel relative w-full max-w-[560px] h-full overflow-y-auto"
        style={{
          minHeight: '100dvh',
          background: t.panelBg,
          borderLeft: `1px solid ${t.panelBorder}`,
          boxShadow: t.panelShadow,
          color: t.text,
        }}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-6 py-5"
          style={{ background: t.headerBg, borderBottom: `1px solid ${t.headerBorder}` }}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <DeptChip slug={current.department} theme={theme} />
              <PriorityBadge value={current.priority} />
              {current.archived && (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                  style={{ background: t.archivedBg, color: t.archivedText }}
                >
                  ARCHIVED
                </span>
              )}
            </div>
            <h2 className="text-[20px] font-extrabold leading-tight break-words"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.text }}>
              {current.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="progress-drawer-close shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-[20px]"
            style={{ border: `1px solid ${t.controlBorder}`, color: t.closeText }}
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {error && (
            <div
              className="rounded-lg px-4 py-3 text-[13px]"
              style={{
                background: t.errorBg,
                border: `1px solid ${t.errorBorder}`,
                color: t.errorText,
              }}
              role="alert"
            >
              {error}
            </div>
          )}

          {/* Summary grid */}
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <Field label="Status" t={t}><StatusBadge value={current.status} /></Field>
            <Field label="Assignee" t={t}>{assigneeName(current.assignee_id)}</Field>
            <Field label="Due" t={t}>{formatDate(current.due_date)}</Field>
            <Field label="Next update due" t={t}>{formatDate(current.next_update_due)}</Field>
            <Field label="Cadence" t={t}>{current.update_cadence_days ? `Every ${current.update_cadence_days}d` : '—'}</Field>
            <Field label="Percent" t={t}>{current.percent_complete}%</Field>
          </div>

          {current.description && (
            <div>
              <div className="text-[11px] font-semibold tracking-[0.12em] mb-1.5" style={{ color: t.muted }}>DETAILS</div>
              <p className="text-[14px] leading-relaxed whitespace-pre-wrap" style={{ color: t.mutedStrong }}>{current.description}</p>
            </div>
          )}

          {/* Admin quick actions */}
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {current.status !== 'done' && (
                <ActionBtn onClick={() => patch({ status: 'done' })} disabled={busy} t={t}>Mark complete</ActionBtn>
              )}
              <ActionBtn onClick={() => patch({ archived: !current.archived })} disabled={busy} t={t}>
                {current.archived ? 'Unarchive' : 'Archive'}
              </ActionBtn>
              {onEdit && <ActionBtn onClick={() => onEdit(current)} disabled={busy} t={t}>Edit</ActionBtn>}
              {canDelete && (
                <ActionBtn onClick={hardDelete} disabled={busy} danger t={t}>Delete</ActionBtn>
              )}
            </div>
          )}

          {/* Post update — the primary action */}
          <form onSubmit={postUpdate} className="rounded-[14px] p-4" style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}` }}>
            <div className="text-[11px] font-semibold tracking-[0.12em] mb-2" style={{ color: t.accentLabel }}>POST UPDATE</div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="What progress did you make? What's blocking you?"
              className="progress-drawer-input w-full rounded-lg px-3 py-2.5 text-[14px] resize-y"
              style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.inputText }}
            />
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <label className="text-[12px]" style={{ color: t.muted }}>
                Status
                <select
                  value={statusChange}
                  onChange={(e) => setStatusChange(e.target.value)}
                  className="progress-drawer-input ml-2 rounded-md px-2 py-1.5 text-[12px]"
                  style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.inputText }}
                >
                  <option value="">No change</option>
                  {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
              <label className="text-[12px]" style={{ color: t.muted }}>
                %
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={percentChange}
                  onChange={(e) => setPercentChange(e.target.value)}
                  placeholder="—"
                  className="progress-drawer-input ml-2 w-16 rounded-md px-2 py-1.5 text-[12px]"
                  style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.inputText }}
                />
              </label>
              <button
                type="submit"
                disabled={posting || !body.trim()}
                className="progress-drawer-submit ml-auto px-5 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.1em] disabled:opacity-40"
                style={{
                  background: t.accent,
                  color: t.accentText,
                  border: 'none',
                  cursor: posting || !body.trim() ? 'not-allowed' : 'pointer',
                  minHeight: '44px',
                }}
              >
                {posting ? 'POSTING…' : 'POST'}
              </button>
            </div>
          </form>

          {/* Thread */}
          <div>
            <div className="text-[11px] font-semibold tracking-[0.12em] mb-3" style={{ color: t.muted }}>UPDATES</div>
            {loading && <p className="text-[13px]" style={{ color: t.muted }}>Loading…</p>}
            {!loading && detail?.updates?.length === 0 && (
              <p className="text-[13px]" style={{ color: t.emptyText }}>No updates yet. Be the first to post progress.</p>
            )}
            <ul className="space-y-3">
              {(detail?.updates || []).map((u) => (
                <li key={u.id} className="rounded-lg p-3" style={{ background: t.cardBg, border: `1px solid ${t.cardBorderSoft}` }}>
                  <p className="text-[14px] leading-relaxed whitespace-pre-wrap break-words" style={{ color: t.textStrong }}>{u.body}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]" style={{ color: t.faint }}>
                    <span>{formatDateTime(u.created_at)}</span>
                    {u.status_to && (
                      <span>· status {u.status_from} → <span style={{ color: t.accentLabel }}>{u.status_to}</span></span>
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
              <summary className="progress-drawer-summary text-[11px] font-semibold tracking-[0.12em] cursor-pointer" style={{ color: t.muted }}>
                ACTIVITY HISTORY ({detail.activity.length})
              </summary>
              <ul className="mt-3 space-y-2">
                {detail.activity.map((a) => (
                  <li key={a.id} className="text-[12px] flex gap-2" style={{ color: t.muted }}>
                    <span style={{ color: t.activityTime }}>{formatDateTime(a.created_at)}</span>
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

function Field({ label, children, t }) {
  return (
    <div>
      <div className="text-[10px] font-semibold tracking-[0.12em] mb-1" style={{ color: t.muted }}>{label.toUpperCase()}</div>
      <div style={{ color: t.textStrong }}>{children}</div>
    </div>
  );
}

function ActionBtn({ children, onClick, disabled, danger, t }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="progress-drawer-action px-4 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.08em] disabled:opacity-40"
      style={{
        minHeight: '44px',
        background: danger ? t.dangerBg : t.controlBg,
        color: danger ? t.dangerText : t.controlText,
        border: `1px solid ${danger ? t.dangerBorder : t.controlBorder}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}
