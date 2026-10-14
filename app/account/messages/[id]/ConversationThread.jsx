'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

// The submitter's side of a conversation with the SDG team. Questions the
// team asked sit at the top with their own answer box until answered; the
// full thread and a general reply box follow.

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

function QuestionCard({ q, onAnswer, disabled }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!draft.trim() || busy) return;
    setBusy(true);
    const ok = await onAnswer(q.id, draft.trim());
    if (ok) setDraft('');
    setBusy(false);
  }
  return (
    <li className="conversation-question">
      <p className="conversation-question-from">{q.author_name} asked · {formatWhen(q.created_at)}</p>
      <p className="conversation-body">{q.body}</p>
      <label className="sr-only" htmlFor={`answer-${q.id}`}>Your answer</label>
      <textarea
        id={`answer-${q.id}`}
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, MAX))}
        placeholder="Your answer"
        disabled={disabled}
      />
      <div className="conversation-actions">
        <button type="button" className="account-hub-button" onClick={submit} disabled={disabled || busy || !draft.trim()}>
          {busy ? 'Sending…' : 'Send answer'}
        </button>
      </div>
    </li>
  );
}

export default function ConversationThread({ initial }) {
  const [conversation, setConversation] = useState(initial.conversation);
  const [messages, setMessages] = useState(initial.messages);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);
  const closed = conversation.status === 'closed';
  const base = `/api/account/conversations/${conversation.id}`;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setConversation(data.conversation);
      setMessages(data.messages);
    } catch {
      // Keep what is on screen; the next poll retries.
    }
  }, [base]);

  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') refresh(); };
    const t = setInterval(tick, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  async function post(body, replyToId = null) {
    setError(null);
    try {
      const res = await fetch(`${base}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, replyToId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Your message could not be sent.');
      await refresh();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  async function sendReply() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    if (await post(body)) setDraft('');
    setBusy(false);
  }

  const byId = new Map(messages.map((m) => [m.id, m]));
  const openQuestions = messages.filter((m) => m.open_question);

  return (
    <section className="conversation" aria-labelledby="conversation-title">
      <Link href="/account/messages" className="account-hub-text-button conversation-back">← All messages</Link>
      <header className="conversation-header">
        <p className="account-hub-eyebrow">{conversation.type_label}{conversation.submitted_at ? ` · Sent ${formatDay(conversation.submitted_at)}` : ''}</p>
        <h2 id="conversation-title">{conversation.subject}</h2>
        <p className="account-hub-note">A private conversation with the Stardust Garage team. Only you and our team can see it.</p>
      </header>

      {openQuestions.length > 0 && !closed && (
        <div className="account-hub-panel conversation-questions">
          <div className="account-hub-panel-heading"><h3>{openQuestions.length === 1 ? 'A question for you' : `${openQuestions.length} questions for you`}</h3></div>
          <ul>
            {openQuestions.map((q) => <QuestionCard key={q.id} q={q} onAnswer={(id, body) => post(body, id)} disabled={closed} />)}
          </ul>
        </div>
      )}

      <div className="account-hub-panel">
        <div className="account-hub-panel-heading"><h3>Conversation</h3></div>
        {messages.length === 0 ? (
          <p className="account-hub-note account-hub-padded">No messages yet.</p>
        ) : (
          <ol className="conversation-thread">
            {messages.map((m) => {
              const question = m.reply_to_id ? byId.get(m.reply_to_id) : null;
              const mine = m.author_kind === 'guest';
              return (
                <li key={m.id} className={`conversation-message ${mine ? 'is-mine' : 'is-team'}${m.kind === 'question' ? ' is-question' : ''}`}>
                  <p className="conversation-message-meta">
                    <span>{mine ? 'You' : `${m.author_name} · Stardust Garage`}</span>
                    {m.kind === 'question' && <span className="conversation-tag">{m.open_question ? 'Question' : 'Answered'}</span>}
                    <span>{formatWhen(m.created_at)}</span>
                  </p>
                  {question && <p className="conversation-quote">Answer to: {question.body.length > 120 ? `${question.body.slice(0, 120)}…` : question.body}</p>}
                  <p className="conversation-body">{m.body}</p>
                </li>
              );
            })}
            <li ref={endRef} aria-hidden="true" />
          </ol>
        )}
        {closed ? (
          <p className="account-hub-note account-hub-padded">This conversation is closed. Email hello@sdgatx.com if you need anything else.</p>
        ) : (
          <div className="conversation-composer">
            <label className="sr-only" htmlFor="conversation-reply">Reply</label>
            <textarea
              id="conversation-reply"
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX))}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(); } }}
              placeholder="Write a reply"
            />
            <div className="conversation-actions">
              <button type="button" className="account-hub-button" onClick={sendReply} disabled={busy || !draft.trim()}>
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        )}
        {error && <p className="account-hub-error account-hub-padded" role="alert">{error}</p>}
      </div>
    </section>
  );
}
