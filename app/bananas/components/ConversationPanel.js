'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// Submission conversation, team side. This is the part the submitter CAN
// see, so it is styled as a neutral card with a "VISIBLE TO …" label, the
// opposite of the amber internal Team Notes panel directly below it.
//
// Before anyone is invited: an invite composer (email + optional opening
// message, sent as a Message or a Question). After: the thread, a composer,
// and Resend / Close controls. The server owns every rule; this component
// only shows controls the server will honor.

const MAX = 5000;
const POLL_MS = 20000;

function formatWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatDay(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function firstNameOf(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'them';
}

const inputStyle = {
  background: 'var(--auth-input-bg)',
  borderColor: 'var(--auth-input-border)',
  color: 'var(--auth-input-text)',
};

const secondaryButton = {
  background: 'var(--auth-card-bg-alt)',
  border: '1px solid var(--auth-card-border-strong)',
  color: 'var(--auth-text)',
};

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 6.5C3 5.12 4.12 4 5.5 4h13C19.88 4 21 5.12 21 6.5v9c0 1.38-1.12 2.5-2.5 2.5H8l-5 3.5V6.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function KindToggle({ value, onChange }) {
  const opts = [
    { id: 'message', label: 'Message' },
    { id: 'question', label: 'Question' },
  ];
  return (
    <div role="radiogroup" aria-label="Send as" className="inline-flex p-0.5 rounded-[8px]" style={{ background: 'var(--auth-card-bg-alt)', border: '1px solid var(--auth-card-border-strong)' }}>
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className="px-3 py-1.5 rounded-[6px] text-[11px] font-semibold tracking-[0.08em]"
          style={value === o.id ? { background: 'var(--auth-text)', color: 'var(--auth-card-bg)' } : { color: 'var(--auth-muted-strong)' }}
        >
          {o.label.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function StatusLine({ thread, name }) {
  if (!thread) return null;
  let text;
  if (thread.status === 'closed') text = `Closed ${formatDay(thread.closed_at)}. ${firstNameOf(name)} can read it but can't reply.`;
  else if (thread.joined) text = `${firstNameOf(name)} joined ${formatDay(thread.claimed_at)} and replies from their SDG account.`;
  else text = `Invite sent to ${thread.invite_email} on ${formatDay(thread.invited_at)}. Not joined yet.`;
  return <p className="text-[12px] mb-4" style={{ color: 'var(--auth-muted)' }}>{text}</p>;
}

function Message({ m, questions, onDelete, busy, seen }) {
  const team = m.author_kind === 'team';
  const answered = m.reply_to_id ? questions.get(m.reply_to_id) : null;
  return (
    <li className={`flex ${team ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[85%] rounded-[10px] px-4 py-3 border"
        style={{
          background: team ? 'var(--auth-card-bg-alt)' : 'var(--auth-card-bg)',
          borderColor: m.kind === 'question' ? 'var(--auth-accent)' : 'var(--auth-card-border-strong)',
        }}
      >
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <span className="text-[12px] font-semibold" style={{ color: 'var(--auth-text-strong)' }}>
            {m.author_name}{m.is_mine ? <span className="font-normal" style={{ color: 'var(--auth-muted)' }}> (you)</span> : null}
          </span>
          {m.kind === 'question' && (
            <span className="text-[10px] font-bold tracking-[0.12em] px-2 py-0.5 rounded-[6px]" style={{ background: 'var(--auth-accent)', color: 'var(--auth-accent-text)' }}>
              QUESTION
            </span>
          )}
          {m.kind === 'question' && (
            <span className="text-[11px]" style={{ color: m.open_question ? 'var(--auth-warn-strong)' : 'var(--auth-muted)' }}>
              {m.open_question ? 'Awaiting answer' : 'Answered'}
            </span>
          )}
          <span className="text-[11px]" style={{ color: 'var(--auth-muted)' }}>{formatWhen(m.created_at)}</span>
        </div>
        {answered && (
          <p className="text-[12px] mb-1.5 pl-2" style={{ color: 'var(--auth-muted)', borderLeft: '2px solid var(--auth-accent)' }}>
            Answer to: {answered.body.length > 120 ? `${answered.body.slice(0, 120)}…` : answered.body}
          </p>
        )}
        <p className="text-[14px] leading-[1.6] break-words" style={{ whiteSpace: 'pre-wrap', color: 'var(--auth-text)' }}>{m.body}</p>
        {(m.can_delete || seen) && (
          <div className="flex items-center justify-end gap-3 mt-1.5">
            {seen && <span className="text-[11px]" style={{ color: 'var(--auth-muted)' }}>Seen</span>}
            {m.can_delete && (
              <button type="button" onClick={() => onDelete(m.id)} disabled={busy} className="text-[11px] font-semibold tracking-[0.08em] hover:underline disabled:opacity-40" style={{ color: 'var(--auth-danger)' }}>
                DELETE
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export default function ConversationPanel({ submissionType, submissionId, initial, loadError = null, defaultOpening = '' }) {
  const [state, setState] = useState(initial);
  const [error, setError] = useState(loadError);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [kind, setKind] = useState('message');
  const [inviteEmail, setInviteEmail] = useState(initial?.submission?.email || '');
  const [opening, setOpening] = useState(defaultOpening);
  const [openingKind, setOpeningKind] = useState('message');
  const [editingEmail, setEditingEmail] = useState(false);
  const listRef = useRef(null);
  const router = useRouter();

  const base = `/api/admin/submissions/${submissionType}/${submissionId}/conversation`;
  const thread = state?.thread || null;
  const messages = state?.messages || [];
  const name = state?.submission?.name || '';
  const first = firstNameOf(name);
  const questions = new Map(messages.filter((m) => m.kind === 'question').map((m) => [m.id, m]));
  const lastTeam = [...messages].reverse().find((m) => m.author_kind === 'team');
  const seenId = lastTeam && thread?.guest_last_read_at && new Date(thread.guest_last_read_at) >= new Date(lastTeam.created_at) ? lastTeam.id : null;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setState(data);
    } catch {
      // Keep the last good state; the next poll will try again.
    }
  }, [base]);

  useEffect(() => {
    if (!thread) return undefined;
    const tick = () => { if (document.visibilityState === 'visible') refresh(); };
    const t = setInterval(tick, POLL_MS);
    return () => clearInterval(t);
  }, [thread, refresh]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function deliveryNotice(delivery) {
    if (!delivery) return null;
    if (delivery.delivered === 'failed') return { tone: 'error', text: delivery.error || 'Saved, but the email could not be sent.' };
    if (delivery.delivered === 'email') return { tone: 'ok', text: `Emailed ${first} a link to reply in SDG.` };
    return { tone: 'ok', text: `Sent to ${first}'s SDG account.` };
  }

  async function invite({ resend = false } = {}) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resend ? { email: inviteEmail } : { email: inviteEmail, body: opening, kind: openingKind }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send the invite.');
      setState(data);
      setEditingEmail(false);
      setNotice(deliveryNotice(data.delivery));
      router.refresh(); // submission status may have moved to Contacted
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${base}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, kind }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send.');
      setDraft('');
      setKind('message');
      setNotice(deliveryNotice(data.delivery));
      await refresh();
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(messageId) {
    if (!window.confirm(`Delete this message? ${first} will no longer see it.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/messages/${messageId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not delete.');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status) {
    if (status === 'closed' && !window.confirm(`Close this conversation? ${first} can still read it but won't be able to reply.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not update.');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e, submit) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  if (!state) {
    return (
      <section id="conversation" aria-label="Conversation with submitter" className="rounded-[14px] p-6 mt-4" style={{ background: 'var(--auth-card-bg)', border: '1px solid var(--auth-card-border-strong)' }}>
        <p className="text-[12px]" role="alert" style={{ color: 'var(--auth-danger)' }}>{error || 'Could not load the conversation.'}</p>
      </section>
    );
  }

  const account = state?.account;
  const accountLine = account?.linked
    ? `${first} already has an SDG account. The conversation appears there right away.`
    : account?.exists
      ? `${inviteEmail || 'This email'} has an SDG account. ${first} signs in to open the conversation.`
      : account?.exists === false
        ? `No SDG account for this email yet. ${first} creates a free one from the invite link.`
        : null;

  return (
    <section
      id="conversation"
      aria-label="Conversation with submitter"
      className="rounded-[14px] p-6 mt-4 scroll-mt-24"
      style={{ background: 'var(--auth-card-bg)', border: '1px solid var(--auth-card-border-strong)' }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2" style={{ color: 'var(--auth-text-strong)' }}>
          <ChatIcon />
          <h2 className="text-[11px] font-bold tracking-[0.16em]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            CONVERSATION{messages.length > 0 ? ` (${messages.length})` : ''}
          </h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold tracking-[0.12em] px-2.5 py-1 rounded-[6px]" style={{ color: 'var(--auth-text)', border: '1px solid var(--auth-card-border-strong)' }}>
            VISIBLE TO {first.toUpperCase()}
          </span>
          {thread && !thread.joined && thread.status === 'open' && (
            <button type="button" onClick={() => setEditingEmail((v) => !v)} disabled={busy} className="px-3 py-1.5 rounded-[8px] text-[11px] font-semibold tracking-[0.08em] hover:opacity-80 disabled:opacity-40" style={secondaryButton}>
              RESEND INVITE
            </button>
          )}
          {thread && (
            <button type="button" onClick={() => setStatus(thread.status === 'closed' ? 'open' : 'closed')} disabled={busy} className="px-3 py-1.5 rounded-[8px] text-[11px] font-semibold tracking-[0.08em] hover:opacity-80 disabled:opacity-40" style={secondaryButton}>
              {thread.status === 'closed' ? 'REOPEN' : 'CLOSE'}
            </button>
          )}
        </div>
      </div>

      {!thread ? (
        <div>
          <p className="text-[13px] leading-[1.6] mb-1" style={{ color: 'var(--auth-text)' }}>
            Invite {first} to continue this inside SDG instead of email or WhatsApp. They get a link, sign in or create a free account, and reply here.
          </p>
          {accountLine && <p className="text-[12px] mb-4" style={{ color: 'var(--auth-muted)' }}>{accountLine}</p>}

          <label className="block text-[11px] font-semibold tracking-[0.12em] mb-1.5" style={{ color: 'var(--auth-muted)' }} htmlFor="conversation-invite-email">SEND INVITE TO</label>
          <input
            id="conversation-invite-email"
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="w-full rounded-[8px] px-3 py-2 text-[14px] border mb-4"
            style={inputStyle}
            autoComplete="off"
          />

          <div className="flex items-center justify-between gap-3 flex-wrap mb-1.5">
            <label className="block text-[11px] font-semibold tracking-[0.12em]" style={{ color: 'var(--auth-muted)' }} htmlFor="conversation-opening">FIRST MESSAGE</label>
            <KindToggle value={openingKind} onChange={setOpeningKind} />
          </div>
          <textarea
            id="conversation-opening"
            value={opening}
            onChange={(e) => setOpening(e.target.value.slice(0, MAX))}
            onKeyDown={(e) => onKeyDown(e, () => invite())}
            rows={5}
            className="w-full rounded-[10px] px-3 py-2.5 text-[14px] leading-[1.55] border resize-y"
            style={inputStyle}
          />
          <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
            <span className="text-[11px]" style={{ color: 'var(--auth-muted)' }}>
              {openingKind === 'question' ? `${first} gets an answer box under this question.` : 'Sent with your name. Moves the submission to Contacted.'}
            </span>
            <button
              type="button"
              onClick={() => invite()}
              disabled={busy || !inviteEmail.trim()}
              className="px-4 py-2 rounded-[8px] text-[11px] font-semibold tracking-[0.1em] hover:opacity-85 disabled:opacity-40"
              style={{ background: 'var(--auth-text)', color: 'var(--auth-card-bg)' }}
            >
              {busy ? 'SENDING…' : 'INVITE TO SDG'}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <StatusLine thread={thread} name={name} />

          {editingEmail && !thread.joined && (
            <div className="rounded-[10px] p-4 mb-4 border" style={{ background: 'var(--auth-card-bg-alt)', borderColor: 'var(--auth-card-border-strong)' }}>
              <label className="block text-[11px] font-semibold tracking-[0.12em] mb-1.5" style={{ color: 'var(--auth-muted)' }} htmlFor="conversation-resend-email">RESEND INVITE TO</label>
              <div className="flex gap-2 flex-wrap">
                <input id="conversation-resend-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="flex-1 min-w-[220px] rounded-[8px] px-3 py-2 text-[14px] border" style={inputStyle} />
                <button type="button" onClick={() => invite({ resend: true })} disabled={busy || !inviteEmail.trim()} className="px-4 py-2 rounded-[8px] text-[11px] font-semibold tracking-[0.1em] disabled:opacity-40" style={{ background: 'var(--auth-text)', color: 'var(--auth-card-bg)' }}>
                  {busy ? 'SENDING…' : 'SEND'}
                </button>
              </div>
              <p className="text-[11px] mt-2" style={{ color: 'var(--auth-muted)' }}>Changing the email cancels earlier invite links.</p>
            </div>
          )}

          {messages.length === 0 ? (
            <p className="text-[13px] mb-4" style={{ color: 'var(--auth-muted)' }}>No messages yet.</p>
          ) : (
            <ul ref={listRef} className="flex flex-col gap-2.5 mb-4 max-h-[520px] overflow-y-auto pr-1">
              {messages.map((m) => (
                <Message key={m.id} m={m} questions={questions} onDelete={remove} busy={busy} seen={m.id === seenId} />
              ))}
            </ul>
          )}

          {thread.status === 'open' ? (
            <div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX))}
                onKeyDown={(e) => onKeyDown(e, send)}
                rows={3}
                placeholder={kind === 'question' ? `Ask ${first} a question…` : `Write to ${first}…`}
                aria-label="New message"
                className="w-full rounded-[10px] px-3 py-2.5 text-[14px] leading-[1.55] border resize-y"
                style={inputStyle}
              />
              <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
                <KindToggle value={kind} onChange={setKind} />
                <button
                  type="button"
                  onClick={send}
                  disabled={busy || !draft.trim()}
                  className="px-4 py-2 rounded-[8px] text-[11px] font-semibold tracking-[0.1em] hover:opacity-85 disabled:opacity-40"
                  style={{ background: 'var(--auth-text)', color: 'var(--auth-card-bg)' }}
                >
                  {busy ? 'SENDING…' : kind === 'question' ? 'ASK' : 'SEND'}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[12px]" style={{ color: 'var(--auth-muted)' }}>Reopen the conversation to write again.</p>
          )}
        </div>
      )}

      {notice && (
        <p className="text-[12px] mt-3" role="status" style={{ color: notice.tone === 'error' ? 'var(--auth-danger)' : 'var(--auth-muted-strong)' }}>{notice.text}</p>
      )}
      {error && <p className="text-[12px] mt-3" role="alert" style={{ color: 'var(--auth-danger)' }}>{error}</p>}
    </section>
  );
}
