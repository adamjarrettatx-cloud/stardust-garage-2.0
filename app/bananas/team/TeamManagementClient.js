'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { adminFetch } from '@/lib/admin-fetch';
import { DEPARTMENTS, departmentLabel } from '@/lib/progress';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

const ROLE_CONFIG = {
  admin: {
    label: 'Admin',
    description: 'Full panel access · manages everything',
    color: '#ffb84d',
    bg: 'rgba(255,184,77,0.12)',
    border: 'rgba(255,184,77,0.3)',
  },
  team: {
    label: 'Team',
    description: 'Team portal only',
    color: '#3b82f6',
    bg: 'rgba(59,130,246,0.1)',
    border: 'rgba(59,130,246,0.3)',
  },
};

// Department tag chip. Static when no onClick is given, otherwise a toggle in
// the tag editor. Mirrors DeptChip in app/bananas/progress/ui.js but themed
// with this page's CSS variables.
function DeptTagChip({ slug, active = true, onClick }) {
  const style = active
    ? { background: 'rgba(59,130,246,0.14)', color: '#7dafff', border: '1px solid rgba(59,130,246,0.35)' }
    : { background: 'var(--auth-card-bg-alt)', color: 'var(--auth-muted)', border: '1px solid var(--auth-card-border)' };
  const className = 'inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-[0.06em]';

  if (!onClick) {
    return <span className={className} style={style}>{departmentLabel(slug)}</span>;
  }
  return (
    <button type="button" onClick={onClick} className={`${className} transition-colors`} style={style}>
      {departmentLabel(slug)}
    </button>
  );
}

export default function TeamManagementClient({ members: initialMembers }) {
  const router = useRouter();
  const supabase = createClient();

  const [members, setMembers] = useState(initialMembers);
  const [showInvite, setShowInvite] = useState(false);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('team');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteDepartments, setInviteDepartments] = useState([]);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');

  // Delete
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Department tag editor
  const [editingTagsId, setEditingTagsId] = useState(null);
  const [draftDepartments, setDraftDepartments] = useState([]);
  const [savingTags, setSavingTags] = useState(false);
  const [tagsError, setTagsError] = useState('');

  const toggleDept = (list, slug) => (
    list.includes(slug) ? list.filter(s => s !== slug) : [...list, slug]
  );

  const openTagEditor = (member) => {
    setTagsError('');
    if (editingTagsId === member.id) {
      setEditingTagsId(null);
      return;
    }
    setEditingTagsId(member.id);
    setDraftDepartments(member.departments || []);
  };

  const handleSaveTags = async (id) => {
    setTagsError('');
    setSavingTags(true);

    try {
      const result = await adminFetch(`/api/admin/team-members/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departments: draftDepartments }),
      });
      setMembers(prev => prev.map(m => (m.id === id ? result.member : m)));
      setEditingTagsId(null);
    } catch (err) {
      setTagsError(err.message);
    }
    setSavingTags(false);
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    setInviteError('');
    setInviteSuccess('');
    setInviting(true);

    let result;
    try {
      result = await adminFetch('/api/admin/invite-team-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim().toLowerCase(),
          full_name: inviteName.trim(),
          role: inviteRole,
          password: invitePassword.trim(),
          departments: inviteDepartments,
        }),
      });
    } catch (fetchErr) {
      setInviteError(fetchErr.message);
      setInviting(false);
      return;
    }

    setInviteSuccess(`${inviteEmail} added as ${inviteRole}. They can now log in at sdgatx.com/login`);
    setMembers(prev => [...prev, result.member]);
    setInviteEmail('');
    setInviteName('');
    setInvitePassword('');
    setInviteRole('team');
    setInviteDepartments([]);
    setShowInvite(false);
    setInviting(false);
    router.refresh();
  };

  const handleDelete = async (id) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setDeletingId(id);

    try {
      await adminFetch('/api/admin/remove-team-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setMembers(prev => prev.filter(m => m.id !== id));
    } catch {
      // Leave the member in place on failure; adminFetch handles the
      // mfa_required redirect itself.
    }
    setDeletingId(null);
    setConfirmDeleteId(null);
    router.refresh();
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
    <>
      <AuthenticatedPageHeader
        title="Team Members"
        description="Manage who has access to the team portal"
        titleClassName="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1]"
        className="mb-10"
      >
        <button
          onClick={() => { setShowInvite(v => !v); setInviteError(''); setInviteSuccess(''); }}
          className="px-6 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5"
          style={{ background: 'var(--auth-text-strong)', color: 'var(--auth-strong-surface-text)' }}
        >
          {showInvite ? 'CANCEL' : '+ ADD MEMBER'}
        </button>
      </AuthenticatedPageHeader>

      {/* Role legend */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        {Object.entries(ROLE_CONFIG).map(([role, cfg]) => (
          <div key={role} className="rounded-[12px] border p-4" style={{ background: cfg.bg, borderColor: cfg.border }}>
            <div className="text-[13px] font-bold mb-1" style={{ color: cfg.color, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {cfg.label}
            </div>
            <div className="text-[12px]" style={{ color: 'var(--auth-muted-strong)' }}>{cfg.description}</div>
          </div>
        ))}
      </div>

      {/* Invite form */}
      {showInvite && (
        <div className="rounded-[14px] border p-6 mb-8" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
          <h2 className="text-[18px] font-bold mb-5" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Add Team Member</h2>
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass} style={labelStyle}>FULL NAME</label>
                <input type="text" value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Jane Doe" className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>EMAIL</label>
                <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} required placeholder="jane@sdgatx.com" className={inputClass} style={inputStyle} />
              </div>
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>TEMPORARY PASSWORD</label>
              <input
                type="text"
                value={invitePassword}
                onChange={e => setInvitePassword(e.target.value)}
                required
                placeholder="They can change this after logging in"
                className={inputClass}
                style={inputStyle}
              />
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--auth-faint)' }}>Share this with them directly. They can update their password after logging in.</p>
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>ROLE</label>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(ROLE_CONFIG).map(([role, cfg]) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setInviteRole(role)}
                    className="py-3 px-4 rounded-[10px] border text-left transition-all"
                    style={{
                      background: inviteRole === role ? cfg.bg : 'var(--auth-card-bg-alt)',
                      borderColor: inviteRole === role ? cfg.border : 'var(--auth-card-border)',
                    }}
                  >
                    <div className="text-[13px] font-bold" style={{ color: inviteRole === role ? cfg.color : 'var(--auth-text)', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                      {cfg.label}
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: 'var(--auth-muted)' }}>{cfg.description}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>TAGS</label>
              <div className="flex flex-wrap gap-1.5">
                {DEPARTMENTS.map(d => (
                  <DeptTagChip
                    key={d.slug}
                    slug={d.slug}
                    active={inviteDepartments.includes(d.slug)}
                    onClick={() => setInviteDepartments(prev => toggleDept(prev, d.slug))}
                  />
                ))}
              </div>
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--auth-faint)' }}>Optional. You can change these any time from the member list.</p>
            </div>

            {inviteError && (
              <div className="text-[13px] text-red-400 p-3 rounded-[10px] border border-red-500/30 bg-red-500/10">{inviteError}</div>
            )}

            <button
              type="submit"
              disabled={inviting}
              className="w-full py-3.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
              style={{ background: 'var(--auth-text-strong)', color: 'var(--auth-strong-surface-text)' }}
            >
              {inviting ? 'ADDING...' : 'ADD TEAM MEMBER'}
            </button>
          </form>
        </div>
      )}

      {inviteSuccess && (
        <div className="mb-6 text-[13px] p-4 rounded-[10px] border" style={{ background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.3)', color: '#34d399' }}>
          ✓ {inviteSuccess}
        </div>
      )}

      <p className="text-[12px] mb-4" style={{ color: 'var(--auth-muted)' }}>
        Tags control which tasks each person sees on their Tasks page — everyone except the owner is
        scoped to their tagged departments plus tasks assigned to or created by them.
      </p>

      {/* Members list */}
      {members.length === 0 ? (
        <div className="rounded-[14px] p-12 text-center border" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
          <p style={{ color: 'var(--auth-muted)' }}>No team members yet. Click &quot;+ ADD MEMBER&quot; to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {members.map(member => {
            const cfg = ROLE_CONFIG[member.role] || ROLE_CONFIG.team;
            const isConfirming = confirmDeleteId === member.id;
            const isEditingTags = editingTagsId === member.id;
            const memberDepartments = member.departments || [];
            return (
              <div
                key={member.id}
                className="rounded-[14px] border p-5"
                style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
              >
                <div className="flex items-center gap-5">
                  {/* Avatar */}
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-bold flex-shrink-0"
                    style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
                  >
                    {(member.full_name || member.email).charAt(0).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-bold truncate" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                      {member.full_name || member.email}
                    </div>
                    <div className="text-[12px] mt-0.5" style={{ color: 'var(--auth-muted)' }}>{member.email}</div>
                  </div>

                  {/* Role badge */}
                  <span
                    className="px-3 py-1 rounded-full text-[11px] font-semibold tracking-[0.1em] flex-shrink-0"
                    style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
                  >
                    {cfg.label.toUpperCase()}
                  </span>

                  {/* Login link — one shared sign-in page for every role */}
                  <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--auth-faint)' }}>
                    /login
                  </span>

                  {/* Remove */}
                  <button
                    onClick={() => handleDelete(member.id)}
                    disabled={deletingId === member.id}
                    className="px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-all disabled:opacity-50 flex-shrink-0"
                    style={{
                      borderColor: isConfirming ? '#ef4444' : 'rgba(239,68,68,0.3)',
                      color: isConfirming ? '#fff' : '#ef4444',
                      background: isConfirming ? '#ef4444' : 'transparent',
                    }}
                  >
                    {deletingId === member.id ? '...' : isConfirming ? 'CONFIRM' : 'REMOVE'}
                  </button>
                </div>

                {/* Department tags */}
                <div className="mt-3 pt-3 flex items-center flex-wrap gap-1.5" style={{ borderTop: '1px solid var(--auth-card-border)' }}>
                  <span className="text-[10px] font-semibold tracking-[0.14em] mr-1" style={{ color: 'var(--auth-faint)' }}>TAGS</span>
                  {memberDepartments.length === 0 ? (
                    <span className="text-[11px]" style={{ color: 'var(--auth-faint)' }}>None — sees only tasks assigned to or created by them</span>
                  ) : (
                    memberDepartments.map(slug => <DeptTagChip key={slug} slug={slug} />)
                  )}
                  <button
                    onClick={() => openTagEditor(member)}
                    className="ml-auto px-3 py-1 rounded-full text-[10px] font-semibold tracking-[0.12em] border transition-all"
                    style={{ borderColor: 'var(--auth-card-border)', color: 'var(--auth-muted-strong)' }}
                  >
                    {isEditingTags ? 'CLOSE' : 'EDIT TAGS'}
                  </button>
                </div>

                {isEditingTags && (
                  <div className="mt-3 rounded-[10px] border p-3" style={{ background: 'var(--auth-card-bg-alt)', borderColor: 'var(--auth-card-border)' }}>
                    <div className="flex flex-wrap gap-1.5">
                      {DEPARTMENTS.map(d => (
                        <DeptTagChip
                          key={d.slug}
                          slug={d.slug}
                          active={draftDepartments.includes(d.slug)}
                          onClick={() => setDraftDepartments(prev => toggleDept(prev, d.slug))}
                        />
                      ))}
                    </div>

                    {tagsError && (
                      <div className="mt-3 text-[12px] text-red-400 p-2 rounded-[8px] border border-red-500/30 bg-red-500/10">{tagsError}</div>
                    )}

                    <button
                      onClick={() => handleSaveTags(member.id)}
                      disabled={savingTags}
                      className="mt-3 px-5 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] transition-all disabled:opacity-50"
                      style={{ background: 'var(--auth-text-strong)', color: 'var(--auth-strong-surface-text)' }}
                    >
                      {savingTags ? 'SAVING...' : 'SAVE TAGS'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
