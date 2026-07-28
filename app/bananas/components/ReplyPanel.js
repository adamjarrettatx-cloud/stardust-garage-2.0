'use client';

import { useState } from 'react';

// Inline "Reply" composer for admin submission detail pages. Sends via
// POST /api/admin/submissions/[type]/[id]/reply — the email goes out from
// the shared hello@sdgatx.com address with Reply-To set to the signed-in
// admin's own work email (server-derived from team_members, never trusted
// from the client), so the recipient's reply lands in that admin's real
// Gmail inbox. The subject/body here are just an editable starting template.
export default function ReplyPanel({ submissionType, submissionId, toEmail, defaultSubject, defaultBody }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null); // { ok: true } | { error: string }

  async function handleSend() {
    if (!subject.trim() || !body.trim()) {
      setResult({ error: 'Subject and message can\u2019t be empty.' });
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/submissions/${submissionType}/${submissionId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: toEmail, subject, body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ error: data.error || 'Failed to send.' });
      } else {
        setResult({ ok: true });
      }
    } catch (err) {
      setResult({ error: err.message || 'Failed to send.' });
    } finally {
      setSending(false);
    }
  }

  if (!toEmail) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-[0.08em] hover:opacity-80 transition-opacity"
        style={{
          background: 'var(--auth-card-bg-alt)',
          border: '1px solid var(--auth-card-border-strong)',
          color: 'var(--auth-text)',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M9 10H15M9 14H12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M3 6.5C3 5.11929 4.11929 4 5.5 4H18.5C19.8807 4 21 5.11929 21 6.5V15.5C21 16.8807 19.8807 18 18.5 18H8L4 21.5V6.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
        REPLY
      </button>
    );
  }

  return (
    <div
      className="rounded-[14px] p-6 border mt-4"
      style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[13px] font-bold tracking-[0.14em]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          REPLY TO {toEmail}
        </h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[12px] hover:underline"
          style={{ color: 'var(--auth-muted)' }}
        >
          Cancel
        </button>
      </div>

      <div className="mb-3">
        <label className="block text-[11px] font-semibold tracking-[0.1em] mb-1.5" style={{ color: 'var(--auth-muted)' }}>
          SUBJECT
        </label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="w-full rounded-[8px] px-3 py-2 text-[14px] border"
          style={{ background: 'var(--auth-card-bg-alt)', borderColor: 'var(--auth-card-border-strong)', color: 'var(--auth-text)' }}
        />
      </div>

      <div className="mb-4">
        <label className="block text-[11px] font-semibold tracking-[0.1em] mb-1.5" style={{ color: 'var(--auth-muted)' }}>
          MESSAGE
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          className="w-full rounded-[8px] px-3 py-2 text-[14px] leading-[1.6] border resize-y"
          style={{ background: 'var(--auth-card-bg-alt)', borderColor: 'var(--auth-card-border-strong)', color: 'var(--auth-text)' }}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSend}
          disabled={sending}
          className="px-4 py-2 rounded-full text-[12px] font-semibold tracking-[0.08em] hover:opacity-85 transition-opacity disabled:opacity-50"
          style={{ background: 'var(--auth-text)', color: 'var(--auth-card-bg)' }}
        >
          {sending ? 'SENDING\u2026' : 'SEND REPLY'}
        </button>
        {result?.ok && (
          <span className="text-[12px]" style={{ color: '#4ade80' }}>Sent \u2014 replies will go to your inbox.</span>
        )}
        {result?.error && (
          <span className="text-[12px]" style={{ color: '#f87171' }}>{result.error}</span>
        )}
      </div>
    </div>
  );
}
