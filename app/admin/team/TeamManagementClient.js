'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const ROLE_CONFIG = {
  admin: {
    label: 'Admin',
    description: 'Full access to everything',
    color: '#ffb84d',
    bg: 'rgba(255,184,77,0.12)',
    border: 'rgba(255,184,77,0.3)',
  },
  team: {
    label: 'Team',
    description: 'Calendar only · own events',
    color: '#3b82f6',
    bg: 'rgba(59,130,246,0.1)',
    border: 'rgba(59,130,246,0.3)',
  },
};

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
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');

  // Delete
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const handleInvite = async (e) => {
    e.preventDefault();
    setInviteError('');
    setInviteSuccess('');
    setInviting(true);

    let res, result;
    try {
      res = await fetch('/api/admin/invite-team-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim().toLowerCase(),
          full_name: inviteName.trim(),
          role: inviteRole,
          password: invitePassword.trim(),
        }),
      });
      result = await res.json();
    } catch (fetchErr) {
      setInviteError('Network error: ' + fetchErr.message);
      setInviting(false);
      return;
    }

    if (!res.ok || result.error) {
      setInviteError(result?.error || `Server error (${res.status})`);
      setInviting(false);
      return;
    }

    setInviteSuccess(`${inviteEmail} added as ${inviteRole}. They can now log in at sdgatx.com/team/login`);
    setMembers(prev => [...prev, result.member]);
    setInviteEmail('');
    setInviteName('');
    setInvitePassword('');
    setInviteRole('team');
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

    const res = await fetch('/api/admin/remove-team-member', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });

    if (res.ok) {
      setMembers(prev => prev.filter(m => m.id !== id));
    }
    setDeletingId(null);
    setConfirmDeleteId(null);
    router.refresh();
  };

  const inputStyle = { background: '#1a1a1a', borderColor: 'rgba(255,255,255,0.12)', color: '#f5f5f5' };
  const inputClass = 'w-full px-4 py-3 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30';
  const labelClass = 'block text-[11px] font-semibold tracking-[0.14em] mb-1.5';
  const labelStyle = { color: '#8a8a8a' };

  return (
    <main className="max-w-[900px] mx-auto px-6 py-16">
      <Link href="/admin" className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-8 transition-opacity hover:opacity-70" style={{ color: '#8a8a8a' }}>
        ← BACK TO ADMIN
      </Link>

      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Team Members
          </h1>
          <p className="text-[13px] mt-2" style={{ color: '#8a8a8a' }}>
            Manage who has access to the team portal
          </p>
        </div>
        <button
          onClick={() => { setShowInvite(v => !v); setInviteError(''); setInviteSuccess(''); }}
          className="px-6 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5"
          style={{ background: '#ffffff', color: '#0a0a0a' }}
        >
          {showInvite ? 'CANCEL' : '+ ADD MEMBER'}
        </button>
      </div>

      {/* Role legend */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        {Object.entries(ROLE_CONFIG).map(([role, cfg]) => (
          <div key={role} className="rounded-[12px] border p-4" style={{ background: cfg.bg, borderColor: cfg.border }}>
            <div className="text-[13px] font-bold mb-1" style={{ color: cfg.color, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {cfg.label}
            </div>
            <div className="text-[12px]" style={{ color: '#aaa' }}>{cfg.description}</div>
          </div>
        ))}
      </div>

      {/* Invite form */}
      {showInvite && (
        <div className="rounded-[14px] border p-6 mb-8" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.08)' }}>
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
              <p className="text-[11px] mt-1.5" style={{ color: '#555' }}>Share this with them directly. They can update their password after logging in.</p>
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
                      background: inviteRole === role ? cfg.bg : '#1a1a1a',
                      borderColor: inviteRole === role ? cfg.border : 'rgba(255,255,255,0.08)',
                    }}
                  >
                    <div className="text-[13px] font-bold" style={{ color: inviteRole === role ? cfg.color : '#f5f5f5', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                      {cfg.label}
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: '#8a8a8a' }}>{cfg.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {inviteError && (
              <div className="text-[13px] text-red-400 p-3 rounded-[10px] border border-red-500/30 bg-red-500/10">{inviteError}</div>
            )}

            <button
              type="submit"
              disabled={inviting}
              className="w-full py-3.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
              style={{ background: '#ffffff', color: '#0a0a0a' }}
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

      {/* Members list */}
      {members.length === 0 ? (
        <div className="rounded-[14px] p-12 text-center border" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}>
          <p style={{ color: '#8a8a8a' }}>No team members yet. Click &quot;+ ADD MEMBER&quot; to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {members.map(member => {
            const cfg = ROLE_CONFIG[member.role] || ROLE_CONFIG.team;
            const isConfirming = confirmDeleteId === member.id;
            return (
              <div
                key={member.id}
                className="rounded-[14px] border p-5 flex items-center gap-5"
                style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}
              >
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
                  <div className="text-[12px] mt-0.5" style={{ color: '#8a8a8a' }}>{member.email}</div>
                </div>

                {/* Role badge */}
                <span
                  className="px-3 py-1 rounded-full text-[11px] font-semibold tracking-[0.1em] flex-shrink-0"
                  style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
                >
                  {cfg.label.toUpperCase()}
                </span>

                {/* Login link */}
                <span className="text-[11px] flex-shrink-0" style={{ color: '#555' }}>
                  {member.role === 'team' ? '/team/login' : '/admin/login'}
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
            );
          })}
        </div>
      )}
    </main>
  );
}
