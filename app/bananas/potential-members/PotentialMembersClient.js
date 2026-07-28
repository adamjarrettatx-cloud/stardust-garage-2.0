'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import {
  POTENTIAL_MEMBER_STATUS_META,
  potentialMemberActionsForStatus,
  potentialMemberStatusPresentation,
} from '@/lib/potential-members';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

function StatusBadge({ status }) {
  const cfg = potentialMemberStatusPresentation(status);
  return (
    <span
      className="px-3 py-1 rounded-full text-[11px] font-semibold tracking-[0.1em] flex-shrink-0"
      style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
    >
      {cfg.label.toUpperCase()}
    </span>
  );
}

function addedByLabel(person) {
  const tm = person.added_by_team_member;
  if (!tm) return 'Unknown';
  return tm.full_name || tm.email || 'Unknown';
}

export default function PotentialMembersClient({ potentialMembers: initial }) {
  const router = useRouter();

  const [people, setPeople] = useState(initial);
  const [showForm, setShowForm] = useState(false);

  // Add form
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Per-row state
  const [updatingId, setUpdatingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [rowError, setRowError] = useState('');

  const resetForm = () => {
    setName('');
    setPhone('');
    setEmail('');
    setNotes('');
    setFormError('');
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);

    let result;
    try {
      result = await adminFetch('/api/admin/potential-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          notes: notes.trim(),
        }),
      });
    } catch (fetchErr) {
      setFormError(fetchErr.message);
      setSaving(false);
      return;
    }

    setPeople((prev) => [result.potentialMember, ...prev]);
    resetForm();
    setShowForm(false);
    setSaving(false);
    router.refresh();
  };

  const handleStatusChange = async (id, nextStatus) => {
    setRowError('');
    setUpdatingId(id);
    try {
      const result = await adminFetch(`/api/admin/potential-members/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      setPeople((prev) => prev.map((p) => (p.id === id ? result.potentialMember : p)));
    } catch (err) {
      setRowError(err.message);
    }
    setUpdatingId(null);
  };

  const handleDelete = async (id) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setDeletingId(id);
    try {
      await adminFetch(`/api/admin/potential-members/${id}`, { method: 'DELETE' });
      setPeople((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setRowError(err.message);
    }
    setDeletingId(null);
    setConfirmDeleteId(null);
  };

  const inputStyle = {
    background: 'var(--auth-input-bg)',
    borderColor: 'var(--auth-input-border)',
    color: 'var(--auth-input-text)',
  };
  const inputClass = 'w-full px-4 py-3 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30';
  const labelClass = 'block text-[11px] font-semibold tracking-[0.14em] mb-1.5';
  const labelStyle = { color: 'var(--auth-muted)' };

  return (
    <main className="max-w-[900px] mx-auto px-6 py-16">
      <AuthenticatedPageHeader
        backHref="/bananas"
        backLabel="← BACK TO ADMIN"
        title="Potential Members"
        description="Jot down people you want as members before they ever apply — added profiles are tagged with whoever created them"
        titleClassName="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1]"
        className="mb-10"
      >
        <button
          onClick={() => { setShowForm((v) => !v); setFormError(''); }}
          className="px-6 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5"
          style={{ background: 'var(--auth-text-strong)', color: 'var(--auth-strong-surface-text)' }}
        >
          {showForm ? 'CANCEL' : '+ CREATE PROFILE'}
        </button>
      </AuthenticatedPageHeader>

      {/* Add form */}
      {showForm && (
        <div className="rounded-[14px] border p-6 mb-8" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
          <h2 className="text-[18px] font-bold mb-5" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Create Potential Member Profile
          </h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className={labelClass} style={labelStyle}>FULL NAME</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Jane Doe"
                className={inputClass}
                style={inputStyle}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass} style={labelStyle}>PHONE</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(512) 555-0100"
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>EMAIL</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@example.com"
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>NOTES</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="How you met them, why you think they'd be a great member, follow-up plans…"
                className={inputClass}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>

            {formError && (
              <div className="text-[13px] text-red-400 p-3 rounded-[10px] border border-red-500/30 bg-red-500/10">{formError}</div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full py-3.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
              style={{ background: 'var(--auth-text-strong)', color: 'var(--auth-strong-surface-text)' }}
            >
              {saving ? 'SAVING…' : 'CREATE PROFILE'}
            </button>
          </form>
        </div>
      )}

      {rowError && (
        <div className="mb-6 text-[13px] p-4 rounded-[10px] border border-red-500/30 bg-red-500/10 text-red-400">{rowError}</div>
      )}

      {/* Status legend */}
      <div className="flex flex-wrap gap-2 mb-6">
        {Object.values(POTENTIAL_MEMBER_STATUS_META).map((cfg) => (
          <span
            key={cfg.value}
            className="px-3 py-1 rounded-full text-[11px] font-semibold tracking-[0.1em]"
            style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
          >
            {cfg.label.toUpperCase()}
          </span>
        ))}
      </div>

      {/* List */}
      {people.length === 0 ? (
        <div className="rounded-[14px] p-12 text-center border" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
          <p style={{ color: 'var(--auth-muted)' }}>
            No potential members yet. Click &quot;+ CREATE PROFILE&quot; whenever someone comes to mind.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {people.map((person) => {
            const isConfirming = confirmDeleteId === person.id;
            const actions = potentialMemberActionsForStatus(person.status);
            return (
              <div
                key={person.id}
                className="rounded-[14px] border p-5"
                style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
              >
                <div className="flex items-start gap-5">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-bold flex-shrink-0"
                    style={{ background: 'var(--auth-card-bg-alt)', color: 'var(--auth-text-strong)', border: '1px solid var(--auth-card-border)' }}
                  >
                    {person.full_name.charAt(0).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-bold truncate" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                      {person.full_name}
                    </div>
                    <div className="text-[12px] mt-0.5 flex flex-wrap gap-x-3" style={{ color: 'var(--auth-muted)' }}>
                      {person.phone && <span>{person.phone}</span>}
                      {person.email && <span>{person.email}</span>}
                    </div>
                    {person.notes && (
                      <p className="text-[13px] mt-2" style={{ color: 'var(--auth-text)' }}>{person.notes}</p>
                    )}
                    <div className="text-[11px] mt-2" style={{ color: 'var(--auth-faint)' }}>
                      Added by {addedByLabel(person)} · {new Date(person.created_at).toLocaleDateString()}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <StatusBadge status={person.status} />
                    <button
                      onClick={() => handleDelete(person.id)}
                      disabled={deletingId === person.id}
                      className="px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-all disabled:opacity-50"
                      style={{
                        borderColor: isConfirming ? '#ef4444' : 'rgba(239,68,68,0.3)',
                        color: isConfirming ? '#fff' : '#ef4444',
                        background: isConfirming ? '#ef4444' : 'transparent',
                      }}
                    >
                      {deletingId === person.id ? '…' : isConfirming ? 'CONFIRM' : 'REMOVE'}
                    </button>
                  </div>
                </div>

                {actions.length > 0 && (
                  <div className="mt-3 pt-3 flex items-center flex-wrap gap-1.5" style={{ borderTop: '1px solid var(--auth-card-border)' }}>
                    <span className="text-[10px] font-semibold tracking-[0.14em] mr-1" style={{ color: 'var(--auth-faint)' }}>MOVE TO</span>
                    {actions.map((action) => (
                      <button
                        key={action.status}
                        onClick={() => handleStatusChange(person.id, action.status)}
                        disabled={updatingId === person.id}
                        className="px-3 py-1 rounded-full text-[10px] font-semibold tracking-[0.1em] border transition-all disabled:opacity-50"
                        style={{ borderColor: 'var(--auth-card-border)', color: 'var(--auth-muted-strong)' }}
                      >
                        {action.label.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
