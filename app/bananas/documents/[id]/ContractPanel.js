'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import {
  CONTRACT_STATUSES,
  CONTRACT_TRANSITIONS,
  SIGNATURE_PROVIDERS,
  isoToVenueInputValue,
  formatVenueDateTime,
} from '@/lib/contract-helpers';

const STATUS_LABEL = Object.fromEntries(CONTRACT_STATUSES.map((s) => [s.value, s.label]));
const STATUS_COLOR = {
  draft: '#8a8a8a',
  pending_review: '#fbbf24',
  sent: '#60a5fa',
  partially_signed: '#a78bfa',
  signed: '#4ade80',
  declined: '#f87171',
  void: '#6b7280',
  expired: '#f59e0b',
};

function StatusBadge({ status }) {
  const color = STATUS_COLOR[status] || '#8a8a8a';
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-[5px] font-semibold tracking-[0.04em] uppercase"
      style={{ background: `${color}22`, color }}
    >
      {STATUS_LABEL[status] || status}
    </span>
  );
}

// Renders + manages the contract lifecycle record for a contract-category
// document. The record is created lazily: the first Save calls PUT, which
// inserts the row and audits a contract_create. Status transitions go through
// the dedicated POST endpoint so the forward-only state machine is enforced
// server-side. SignNow controls degrade gracefully when unconfigured.
export default function ContractPanel({ documentId, initialContract, events, signNowConfigured }) {
  const router = useRouter();
  const [contract, setContract] = useState(initialContract);
  const [editing, setEditing] = useState(!initialContract);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [transitioning, setTransitioning] = useState(false);
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const [form, setForm] = useState({
    counterparty_name: initialContract?.counterparty_name || '',
    counterparty_email: initialContract?.counterparty_email || '',
    signature_provider: initialContract?.signature_provider || 'none',
    event_id: initialContract?.event_id || '',
    effective_date: isoToVenueInputValue(initialContract?.effective_date),
    expiration_date: isoToVenueInputValue(initialContract?.expiration_date),
    notes: initialContract?.notes || '',
  });

  const [signers, setSigners] = useState(
    Array.isArray(initialContract?.signers) ? initialContract.signers : [],
  );

  const status = contract?.status || 'draft';
  const allowedNext = CONTRACT_TRANSITIONS[status] || [];

  // SignNow send prerequisites, mirrored from the server route so the UI can
  // explain *why* the button is disabled instead of failing on click.
  const savedSigners = Array.isArray(contract?.signers) ? contract.signers : [];
  const isTerminal = (CONTRACT_STATUSES.find((s) => s.value === status)?.terminal) ?? false;
  const hasEnvelope = Boolean(contract?.external_envelope_id);
  const sendBlockedReason = !signNowConfigured
    ? 'Set SIGNNOW_API_KEY (server-only) to enable sending.'
    : isTerminal
      ? `Contract is ${STATUS_LABEL[status] || status}; cannot send.`
      : savedSigners.length === 0
        ? 'Add and save at least one signer before sending.'
        : null;
  const canSend = sendBlockedReason === null;

  function updateSigner(i, field, value) {
    setSigners((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)));
  }
  function addSigner() {
    setSigners((prev) => [...prev, { name: '', email: '', role: 'signer', order: prev.length + 1, status: 'pending', signed_at: null }]);
  }
  function removeSigner(i) {
    setSigners((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    setSaving(true); setError(null); setNotice(null);
    try {
      const body = {
        counterparty_name: form.counterparty_name,
        counterparty_email: form.counterparty_email,
        signature_provider: form.signature_provider,
        event_id: form.event_id || null,
        effective_date: form.effective_date || null,
        expiration_date: form.expiration_date || null,
        notes: form.notes,
        signers: signers
          .filter((s) => s.name || s.email)
          .map((s, i) => ({ ...s, order: i + 1 })),
      };
      const json = await adminFetch(`/api/admin/documents/${documentId}/contract`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setContract(json.contract);
      setSigners(Array.isArray(json.contract?.signers) ? json.contract.signers : []);
      setEditing(false);
      setNotice('Contract details saved.');
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function transition(next) {
    setTransitioning(true); setError(null); setNotice(null);
    try {
      const json = await adminFetch(`/api/admin/documents/${documentId}/contract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      setContract(json.contract);
      setNotice(`Status changed to ${STATUS_LABEL[next] || next}.`);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setTransitioning(false);
    }
  }

  async function sendViaSignNow() {
    setSending(true); setError(null); setNotice(null);
    try {
      // adminFetch throws json.hint || json.error on non-OK, so the expected
      // unconfigured responses surface as a hint, not a crash.
      const json = await adminFetch(`/api/admin/documents/${documentId}/contract/signnow`, { method: 'POST' });
      if (json.contract) setContract(json.contract);
      setNotice(`Sent for signature via SignNow${json.envelopeId ? ` (envelope ${json.envelopeId})` : ''}.`);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function syncSignNowStatus() {
    setSyncing(true); setError(null); setNotice(null);
    try {
      const json = await adminFetch(`/api/admin/documents/${documentId}/contract/signnow?sync=1`);
      if (json.contract) setContract((c) => ({ ...c, ...json.contract }));
      const base = json.changed
        ? `Status synced — now ${STATUS_LABEL[json.contract?.status] || json.contract?.status}.`
        : 'Status synced — no change.';
      let archiveMsg = '';
      if (json.archived?.ok) {
        archiveMsg = ` Signed PDF archived as version ${json.archived.versionNumber}.`;
      } else if (json.archived && !json.archived.ok && json.archived.reason !== 'signed PDF already archived') {
        archiveMsg = ` (Signed PDF not archived: ${json.archived.reason}.)`;
      } else if (json.archived?.reason === 'signed PDF already archived') {
        archiveMsg = ' Signed PDF already on file.';
      }
      setNotice(base + archiveMsg);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  }

  async function archiveSignedPdf() {
    setArchiving(true); setError(null); setNotice(null);
    try {
      const json = await adminFetch(`/api/admin/documents/${documentId}/contract/signnow?archive=1`);
      if (json.archived) {
        setNotice(`Signed PDF archived as version ${json.versionNumber}. It now appears in this document's version history.`);
      } else {
        setNotice(json.reason === 'signed PDF already archived'
          ? 'Signed PDF is already on file — no duplicate created.'
          : `Signed PDF not archived: ${json.reason}.`);
      }
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setArchiving(false);
    }
  }

  const inputStyle = { background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.08)', color: 'white' };

  return (
    <div className="rounded-[14px] border p-5 mb-6" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase" style={{ color: '#8a8a8a' }}>
          Contract Lifecycle
        </h2>
        {contract && <StatusBadge status={status} />}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-[10px] text-[13px]" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 p-3 rounded-[10px] text-[13px]" style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', color: '#86efac' }}>
          {notice}
        </div>
      )}

      {!contract && !editing && (
        <div>
          <p className="text-[13px] mb-3" style={{ color: '#8a8a8a' }}>
            No contract lifecycle record yet. Track signature status, counterparty, and signers.
          </p>
          <button onClick={() => setEditing(true)}
            className="px-5 py-2.5 text-[13px] font-semibold rounded-[10px] tracking-[0.06em] uppercase"
            style={{ background: 'white', color: 'black' }}>
            Start tracking
          </button>
        </div>
      )}

      {editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Counterparty name" value={form.counterparty_name}
              onChange={(e) => setForm({ ...form, counterparty_name: e.target.value })}
              className="px-3 py-2.5 text-[14px] rounded-[10px] outline-none" style={inputStyle} />
            <input placeholder="Counterparty email" value={form.counterparty_email}
              onChange={(e) => setForm({ ...form, counterparty_email: e.target.value })}
              className="px-3 py-2.5 text-[14px] rounded-[10px] outline-none" style={inputStyle} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[12px]" style={{ color: '#8a8a8a' }}>
              Effective date &amp; time <span style={{ color: '#6a6a6a' }}>(venue time, CT)</span>
              <input type="datetime-local" value={form.effective_date}
                onChange={(e) => setForm({ ...form, effective_date: e.target.value })}
                className="mt-1 w-full px-3 py-2.5 text-[14px] rounded-[10px] outline-none" style={inputStyle} />
            </label>
            <label className="text-[12px]" style={{ color: '#8a8a8a' }}>
              Expiration date &amp; time <span style={{ color: '#6a6a6a' }}>(venue time, CT)</span>
              <input type="datetime-local" value={form.expiration_date}
                onChange={(e) => setForm({ ...form, expiration_date: e.target.value })}
                className="mt-1 w-full px-3 py-2.5 text-[14px] rounded-[10px] outline-none" style={inputStyle} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[12px]" style={{ color: '#8a8a8a' }}>
              Signature provider
              <select value={form.signature_provider}
                onChange={(e) => setForm({ ...form, signature_provider: e.target.value })}
                className="mt-1 w-full px-3 py-2.5 text-[14px] rounded-[10px] outline-none cursor-pointer" style={inputStyle}>
                {SIGNATURE_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="text-[12px]" style={{ color: '#8a8a8a' }}>
              Linked event
              <select value={form.event_id}
                onChange={(e) => setForm({ ...form, event_id: e.target.value })}
                className="mt-1 w-full px-3 py-2.5 text-[14px] rounded-[10px] outline-none cursor-pointer" style={inputStyle}>
                <option value="">No event link</option>
                {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}{ev.event_date ? ` · ${ev.event_date}` : ''}</option>)}
              </select>
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px]" style={{ color: '#8a8a8a' }}>Signers</span>
              <button onClick={addSigner} className="text-[12px] hover:underline" style={{ color: 'white' }}>+ Add signer</button>
            </div>
            <div className="space-y-2">
              {signers.length === 0 && <p className="text-[12px]" style={{ color: '#6a6a6a' }}>No signers added.</p>}
              {signers.map((s, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
                  <input placeholder="Name" value={s.name}
                    onChange={(e) => updateSigner(i, 'name', e.target.value)}
                    className="px-3 py-2 text-[13px] rounded-[8px] outline-none" style={inputStyle} />
                  <input placeholder="Email" value={s.email}
                    onChange={(e) => updateSigner(i, 'email', e.target.value)}
                    className="px-3 py-2 text-[13px] rounded-[8px] outline-none" style={inputStyle} />
                  <select value={s.role} onChange={(e) => updateSigner(i, 'role', e.target.value)}
                    className="px-2 py-2 text-[13px] rounded-[8px] outline-none cursor-pointer" style={inputStyle}>
                    <option value="signer">signer</option>
                    <option value="approver">approver</option>
                    <option value="cc">cc</option>
                  </select>
                  <button onClick={() => removeSigner(i)} className="text-[12px] px-2 py-1.5 rounded-[8px]"
                    style={{ border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>✕</button>
                </div>
              ))}
            </div>
          </div>

          <textarea placeholder="Notes" value={form.notes} rows={2}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="w-full px-3 py-2.5 text-[14px] rounded-[10px] outline-none resize-none" style={inputStyle} />

          <div className="flex justify-end gap-2">
            {contract && (
              <button onClick={() => setEditing(false)} disabled={saving}
                className="px-4 py-2 text-[13px] rounded-[10px]" style={{ border: '1px solid rgba(255,255,255,0.10)', color: 'white' }}>
                Cancel
              </button>
            )}
            <button onClick={save} disabled={saving}
              className="px-5 py-2 text-[13px] font-semibold rounded-[10px] tracking-[0.06em] uppercase"
              style={{ background: 'white', color: 'black', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Save contract'}
            </button>
          </div>
        </div>
      ) : contract ? (
        <>
          <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-[13px] mb-4">
            <dt style={{ color: '#8a8a8a' }}>Provider</dt><dd>{contract.signature_provider}</dd>
            {contract.counterparty_name && (<><dt style={{ color: '#8a8a8a' }}>Counterparty</dt><dd>{contract.counterparty_name}{contract.counterparty_email ? ` · ${contract.counterparty_email}` : ''}</dd></>)}
            {contract.effective_date && (<><dt style={{ color: '#8a8a8a' }}>Effective</dt><dd>{formatVenueDateTime(contract.effective_date)}</dd></>)}
            {contract.expiration_date && (<><dt style={{ color: '#8a8a8a' }}>Expires</dt><dd>{formatVenueDateTime(contract.expiration_date)}</dd></>)}
            {contract.external_envelope_id && (<><dt style={{ color: '#8a8a8a' }}>SignNow envelope</dt><dd className="font-mono text-[12px]">{contract.external_envelope_id}</dd></>)}
            {contract.sent_at && (<><dt style={{ color: '#8a8a8a' }}>Sent</dt><dd>{new Date(contract.sent_at).toLocaleString()}</dd></>)}
            {contract.completed_at && (<><dt style={{ color: '#8a8a8a' }}>Completed</dt><dd>{new Date(contract.completed_at).toLocaleString()}</dd></>)}
            {Array.isArray(contract.signers) && contract.signers.length > 0 && (
              <>
                <dt style={{ color: '#8a8a8a' }}>Signers</dt>
                <dd className="space-y-1">
                  {contract.signers.map((s, i) => (
                    <div key={i}>{s.name} <span style={{ color: '#8a8a8a' }}>({s.email}) · {s.role} · {s.status}</span></div>
                  ))}
                </dd>
              </>
            )}
            {contract.notes && (<><dt style={{ color: '#8a8a8a' }}>Notes</dt><dd className="whitespace-pre-wrap">{contract.notes}</dd></>)}
          </dl>

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <button onClick={() => setEditing(true)}
              className="text-[12px] px-3 py-1.5 rounded-[8px]" style={{ border: '1px solid rgba(255,255,255,0.10)', color: 'white' }}>
              Edit details
            </button>
            {allowedNext.map((next) => (
              <button key={next} onClick={() => transition(next)} disabled={transitioning}
                className="text-[12px] px-3 py-1.5 rounded-[8px]"
                style={{ border: '1px solid rgba(255,255,255,0.10)', color: 'white', opacity: transitioning ? 0.6 : 1 }}>
                → {STATUS_LABEL[next] || next}
              </button>
            ))}
            {allowedNext.length === 0 && (
              <span className="text-[12px]" style={{ color: '#6a6a6a' }}>Terminal status — no further transitions.</span>
            )}
          </div>

          {/* SignNow readiness — degrades gracefully when unconfigured */}
          <div className="pt-3 mt-1 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[12px]" style={{ color: '#8a8a8a' }}>
                SignNow:{' '}
                <span style={{ color: signNowConfigured ? '#86efac' : '#fbbf24' }}>
                  {signNowConfigured ? 'configured' : 'not configured'}
                </span>
                {hasEnvelope && (
                  <span style={{ color: '#60a5fa' }}> · envelope sent</span>
                )}
                {status === 'signed' && (
                  <span style={{ color: '#4ade80' }}> · fully signed</span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={sendViaSignNow}
                  disabled={sending || !canSend}
                  title={canSend ? 'Send this contract for e-signature' : sendBlockedReason}
                  className="text-[12px] px-3 py-1.5 rounded-[8px]"
                  style={{
                    border: '1px solid rgba(255,255,255,0.10)',
                    color: canSend ? 'white' : '#6a6a6a',
                    cursor: canSend ? 'pointer' : 'not-allowed',
                    opacity: sending ? 0.6 : 1,
                  }}>
                  {sending ? 'Sending…' : hasEnvelope ? 'Resend via SignNow' : 'Send via SignNow'}
                </button>
                {signNowConfigured && hasEnvelope && (
                  <>
                    <button
                      onClick={syncSignNowStatus}
                      disabled={syncing}
                      title="Pull the latest signature status from SignNow (read-only)"
                      className="text-[12px] px-3 py-1.5 rounded-[8px]"
                      style={{ border: '1px solid rgba(255,255,255,0.10)', color: 'white', opacity: syncing ? 0.6 : 1 }}>
                      {syncing ? 'Checking…' : 'Check status'}
                    </button>
                    <a
                      href={`/api/admin/documents/${documentId}/contract/signnow?download=1`}
                      className="text-[12px] px-3 py-1.5 rounded-[8px] inline-block"
                      style={{ border: '1px solid rgba(255,255,255,0.10)', color: 'white' }}>
                      Download signed
                    </a>
                    {status === 'signed' && (
                      <button
                        onClick={archiveSignedPdf}
                        disabled={archiving}
                        title="Store the signed PDF as a new private version of this document (idempotent)"
                        className="text-[12px] px-3 py-1.5 rounded-[8px]"
                        style={{ border: '1px solid rgba(255,255,255,0.10)', color: 'white', opacity: archiving ? 0.6 : 1 }}>
                        {archiving ? 'Archiving…' : 'Archive signed PDF'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            {!canSend && (
              <p className="text-[11px] mt-2" style={{ color: '#6a6a6a' }}>
                {sendBlockedReason}
                {!signNowConfigured && ' Until then, advance status manually as signatures complete offline.'}
              </p>
            )}
            {signNowConfigured && hasEnvelope && (
              <p className="text-[11px] mt-2 leading-relaxed" style={{ color: '#6a6a6a' }}>
                Status updates arrive automatically when the SignNow webhook is configured;
                use <span style={{ color: '#8a8a8a' }}>Check status</span> to pull on demand.
                {status === 'signed'
                  ? ' Once fully signed, the signed PDF is archived as a new version of this document (auto on sync, or via Archive signed PDF). Archival is idempotent — it never creates duplicates.'
                  : ' When fully signed, the signed PDF is archived into this document’s version history automatically.'}
              </p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
