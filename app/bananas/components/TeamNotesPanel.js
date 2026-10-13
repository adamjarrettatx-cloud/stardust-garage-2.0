'use client';

import { useState } from 'react';

// Internal team notes for a submission detail page. Deliberately styled
// unlike the submitter's answers (amber "internal" surface, lock label,
// author + timestamp on every entry) so nobody mistakes a teammate's note
// for something the submitter wrote. Every admin who can open the
// submission can read and add notes; the server records who wrote each one.

const MAX = 5000;

function formatWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function initials(name) {
  return (
    (name || '?')
      .trim()
      .split(/[\s@.]+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('') || '?'
  );
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const textareaStyle = {
  background: 'var(--auth-input-bg)',
  borderColor: 'var(--auth-input-border)',
  color: 'var(--auth-input-text)',
};

export default function TeamNotesPanel({ submissionType, submissionId, initialNotes = [], loadError = null }) {
  const [notes, setNotes] = useState(initialNotes);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(loadError);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [busyId, setBusyId] = useState(null);

  const base = `/api/admin/submissions/${submissionType}/${submissionId}/notes`;

  async function addNote() {
    const body = draft.trim();
    if (!body || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save note.');
      setNotes((prev) => [data.note, ...prev]);
      setDraft('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(id) {
    const body = editDraft.trim();
    if (!body) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`${base}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not update note.');
      setNotes((prev) => prev.map((n) => (n.id === id ? data.note : n)));
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function removeNote(id) {
    if (!window.confirm('Delete this note for everyone on the team?')) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`${base}/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not delete note.');
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  function onKeyDown(e, submit) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <section
      aria-label="Internal team notes"
      className="rounded-[14px] p-6 mb-4 mt-4"
      style={{
        background: 'var(--auth-warn-bg)',
        border: '1px solid var(--auth-warn-border)',
        borderLeft: '4px solid var(--auth-accent)',
      }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-2" style={{ color: 'var(--auth-warn-strong)' }}>
          <LockIcon />
          <h2
            className="text-[11px] font-bold tracking-[0.16em]"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            TEAM NOTES{notes.length > 0 ? ` (${notes.length})` : ''}
          </h2>
        </div>
        <span
          className="text-[10px] font-semibold tracking-[0.12em] px-2.5 py-1 rounded-[6px]"
          style={{ color: 'var(--auth-warn-strong)', border: '1px solid var(--auth-warn-border)' }}
        >
          INTERNAL · NOT VISIBLE TO SUBMITTER
        </span>
      </div>

      <div className="mb-4">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX))}
          onKeyDown={(e) => onKeyDown(e, addNote)}
          rows={3}
          placeholder="Add a note for the team…"
          aria-label="New team note"
          className="w-full rounded-[10px] px-3 py-2.5 text-[14px] leading-[1.55] border resize-y"
          style={textareaStyle}
        />
        <div className="flex items-center justify-between gap-3 mt-2">
          <span className="text-[11px]" style={{ color: 'var(--auth-muted)' }}>
            Saved with your name and the time. Visible to every admin.
          </span>
          <button
            type="button"
            onClick={addNote}
            disabled={saving || !draft.trim()}
            className="px-4 py-2 rounded-[8px] text-[11px] font-semibold tracking-[0.1em] hover:opacity-85 transition-opacity disabled:opacity-40"
            style={{ background: 'var(--auth-text)', color: 'var(--auth-card-bg)' }}
          >
            {saving ? 'SAVING…' : 'ADD NOTE'}
          </button>
        </div>
        {error && (
          <p className="text-[12px] mt-2" style={{ color: 'var(--auth-danger)' }} role="alert">
            {error}
          </p>
        )}
      </div>

      {notes.length === 0 ? (
        <p className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
          No team notes yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {notes.map((n) => (
            <li
              key={n.id}
              className="rounded-[10px] p-4 border"
              style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border-strong)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="flex-shrink-0 flex items-center justify-center rounded-full text-[11px] font-bold"
                    style={{
                      width: 28,
                      height: 28,
                      background: 'var(--auth-accent)',
                      color: 'var(--auth-accent-text)',
                    }}
                    aria-hidden="true"
                  >
                    {initials(n.author_name)}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--auth-text-strong)' }}>
                      {n.author_name}
                      {n.is_mine && (
                        <span className="font-normal" style={{ color: 'var(--auth-muted)' }}> (you)</span>
                      )}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--auth-muted)' }}>
                      {formatWhen(n.created_at)}
                      {n.edited_at ? ` · edited ${formatWhen(n.edited_at)}` : ''}
                    </div>
                  </div>
                </div>
                {editingId !== n.id && (n.can_edit || n.can_delete) && (
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {n.can_edit && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(n.id);
                          setEditDraft(n.body);
                        }}
                        className="text-[11px] font-semibold tracking-[0.08em] hover:underline"
                        style={{ color: 'var(--auth-muted-strong)' }}
                      >
                        EDIT
                      </button>
                    )}
                    {n.can_delete && (
                      <button
                        type="button"
                        onClick={() => removeNote(n.id)}
                        disabled={busyId === n.id}
                        className="text-[11px] font-semibold tracking-[0.08em] hover:underline disabled:opacity-40"
                        style={{ color: 'var(--auth-danger)' }}
                      >
                        DELETE
                      </button>
                    )}
                  </div>
                )}
              </div>

              {editingId === n.id ? (
                <div className="mt-3">
                  <textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value.slice(0, MAX))}
                    onKeyDown={(e) => onKeyDown(e, () => saveEdit(n.id))}
                    rows={3}
                    aria-label="Edit team note"
                    className="w-full rounded-[10px] px-3 py-2.5 text-[14px] leading-[1.55] border resize-y"
                    style={textareaStyle}
                  />
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      type="button"
                      onClick={() => saveEdit(n.id)}
                      disabled={busyId === n.id || !editDraft.trim()}
                      className="px-4 py-1.5 rounded-[8px] text-[11px] font-semibold tracking-[0.1em] hover:opacity-85 disabled:opacity-40"
                      style={{ background: 'var(--auth-text)', color: 'var(--auth-card-bg)' }}
                    >
                      {busyId === n.id ? 'SAVING…' : 'SAVE'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="text-[12px] hover:underline"
                      style={{ color: 'var(--auth-muted)' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p
                  className="text-[14px] leading-[1.6] mt-3 break-words"
                  style={{ whiteSpace: 'pre-wrap', color: 'var(--auth-text)' }}
                >
                  {n.body}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
