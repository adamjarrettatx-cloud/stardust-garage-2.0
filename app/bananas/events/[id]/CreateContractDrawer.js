'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import {
  TEMPLATE_KINDS,
  templateKindLabel,
  validateContractSetup,
  organizerDisplayLabel,
  defaultSignerEmail,
  defaultSignerName,
} from '@/lib/event-organizer';
import { isoToVenueInputValue, CONTRACT_TIME_ZONE } from '@/lib/contract-helpers';

// The "Create Contract" step, opened from the Event Contracts panel. This is the
// primary staff entry point for contracts — the Documents Hub is the archive.
//
// It only collects the RELATIONSHIP: which template, which Master Agreement it
// falls under, who signs, and the dates. Placing and filling fields happens on
// the contract detail page afterwards using the existing field editor, so this
// drawer stays short enough to complete on a phone at the door.
//
// It renders as a right-hand slide-over on desktop and a full-height sheet on
// mobile.

const labelClass = 'block text-[11px] font-semibold tracking-[0.14em] mb-2';
const labelStyle = { color: 'var(--auth-muted)' };
const inputClass =
  'w-full px-4 py-3 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30';
const inputStyle = {
  background: 'var(--auth-input-bg)',
  borderColor: 'var(--auth-input-border)',
  color: 'var(--auth-input-text)',
};

function templateGroups(templates) {
  return TEMPLATE_KINDS.map((k) => ({
    ...k,
    items: templates.filter((t) => (t.kind || 'other') === k.value),
  })).filter((g) => g.items.length > 0);
}

export default function CreateContractDrawer({
  open,
  onClose,
  onCreated,
  event,
  organizer,
  masters = [],
  templates = [],
}) {
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [masterContractId, setMasterContractId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const closeRef = useRef(null);

  const template = useMemo(
    () => templates.find((t) => t.id === templateId) || null,
    [templates, templateId],
  );

  // Default the title to "<Event> — <Template>" so the archive is searchable
  // without staff having to name anything. Only auto-fills while untouched.
  const [titleTouched, setTitleTouched] = useState(false);
  useEffect(() => {
    if (titleTouched) return;
    if (!template) {
      setTitle('');
      return;
    }
    const parts = [event?.title, template.title].filter(Boolean);
    setTitle(parts.join(' — '));
  }, [template, event?.title, titleTouched]);

  // Default the effective date to the event date — the overwhelmingly common
  // case for an event agreement.
  useEffect(() => {
    if (!open) return;
    if (effectiveDate) return;
    if (event?.event_date) setEffectiveDate(isoToVenueInputValue(event.event_date) || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.event_date]);

  // Reset when reopened so a canceled attempt never leaks into the next one.
  useEffect(() => {
    if (open) {
      setError('');
      closeRef.current?.focus();
      return;
    }
    setTemplateId('');
    setMasterContractId('');
    setNotes('');
    setTitleTouched(false);
    setBusy(false);
  }, [open]);

  // Escape closes, matching every other overlay in the admin.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const signerEmail = defaultSignerEmail(organizer);
  const signerName = defaultSignerName(organizer);
  const needsMaster = !!(template && template.kind === 'event' && template.requires_master);

  // Client-side preview of the exact server rule, so the button explains itself
  // instead of failing after a round trip.
  const check = validateContractSetup({
    template: template || null,
    eventId: event?.id || null,
    organizerContactId: organizer?.id || null,
    masterContractId: masterContractId || null,
    effectiveDate: effectiveDate || null,
    expirationDate: expirationDate || null,
  });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(true);
    try {
      const json = await adminFetch('/api/admin/documents/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: templateId,
          title: title.trim() || undefined,
          event_id: event.id,
          contact_id: organizer.id,
          master_contract_id: masterContractId || null,
          effective_date: effectiveDate || null,
          expiration_date: expirationDate || null,
          notes: notes.trim() || null,
        }),
      });
      onCreated?.(json);
    } catch (err) {
      setError(err.message || 'Could not create the contract.');
      setBusy(false);
    }
  };

  const groups = templateGroups(templates);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Create contract">
      <button
        type="button"
        aria-label="Close"
        onClick={() => !busy && onClose()}
        className="absolute inset-0 bg-black/70"
      />

      <div
        className="relative w-full sm:max-w-[520px] h-full overflow-y-auto border-l"
        style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border-strong)' }}
      >
        <div
          className="sticky top-0 z-10 px-5 sm:px-6 py-4 border-b flex items-center justify-between gap-3"
          style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
        >
          <div>
            <div className="text-[15px] font-bold" style={{ color: 'var(--auth-text-strong)' }}>
              Create Contract
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--auth-muted)' }}>
              {event?.title || 'This event'}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={() => !busy && onClose()}
            className="px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors hover:bg-white/5"
            style={{ borderColor: 'var(--auth-card-border-strong)', color: 'var(--auth-text)' }}
          >
            CLOSE
          </button>
        </div>

        <form onSubmit={submit} className="px-5 sm:px-6 py-5 space-y-6">
          {/* WHO IT'S WITH — read-only. The counterparty comes from the event's
              Event Organizer profile; changing it means changing the event, which
              is deliberate: one event, one organizer, no divergent copies. */}
          <div
            className="rounded-[10px] border p-4"
            style={{ background: 'var(--auth-card-bg-alt)', borderColor: 'var(--auth-card-border)' }}
          >
            <div className="text-[11px] font-semibold tracking-[0.14em] mb-2" style={labelStyle}>
              EVENT ORGANIZER
            </div>
            <div className="text-[14px] font-semibold" style={{ color: 'var(--auth-text-strong)' }}>
              {organizerDisplayLabel(organizer) || '—'}
            </div>
            <div className="text-[12px] mt-1" style={{ color: 'var(--auth-muted)' }}>
              {signerEmail
                ? `Signs as ${signerName} · ${signerEmail}`
                : 'No signer email on this profile — the contract can be drafted but not sent.'}
            </div>
          </div>

          <div>
            <label className={labelClass} style={labelStyle}>
              TEMPLATE
            </label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className={inputClass}
              style={inputStyle}
              required
            >
              <option value="">— Select a template —</option>
              {groups.map((g) => (
                <optgroup key={g.value} label={g.label}>
                  {g.items.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                      {t.requires_master ? ' (needs Master Agreement)' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {template && (
              <p className="text-[11px] mt-2" style={{ color: 'var(--auth-muted)' }}>
                {templateKindLabel(template.kind)} · {template.field_count} field
                {template.field_count === 1 ? '' : 's'} pre-placed
                {template.page_count ? ` · ${template.page_count} page${template.page_count === 1 ? '' : 's'}` : ''}
                {template.description ? ` · ${template.description}` : ''}
              </p>
            )}
          </div>

          {/* MASTER AGREEMENT REFERENCE — the relationship hook. We store the
              link only; the legal text lives in the template PDF. */}
          {template && template.kind === 'event' && (
            <div>
              <label className={labelClass} style={labelStyle}>
                UNDER MASTER AGREEMENT {needsMaster ? '(REQUIRED)' : '(OPTIONAL)'}
              </label>
              <select
                value={masterContractId}
                onChange={(e) => setMasterContractId(e.target.value)}
                className={inputClass}
                style={inputStyle}
                required={needsMaster}
              >
                <option value="">— None —</option>
                {masters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title} ({m.status.replace(/_/g, ' ')})
                  </option>
                ))}
              </select>
              <p className="text-[11px] mt-2" style={{ color: 'var(--auth-muted)' }}>
                {masters.length === 0
                  ? 'This organizer has no Master Agreement on file yet. Send one first if this template requires it.'
                  : 'Ties this event agreement to the organizer’s standing terms.'}
              </p>
            </div>
          )}

          <div>
            <label className={labelClass} style={labelStyle}>
              DOCUMENT TITLE
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitleTouched(true);
                setTitle(e.target.value);
              }}
              placeholder="How this shows up in the Documents archive"
              className={inputClass}
              style={inputStyle}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass} style={labelStyle}>
                EFFECTIVE
              </label>
              <input
                type="datetime-local"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>
                EXPIRES
              </label>
              <input
                type="datetime-local"
                value={expirationDate}
                onChange={(e) => setExpirationDate(e.target.value)}
                className={inputClass}
                style={inputStyle}
              />
            </div>
          </div>
          <p className="text-[11px] -mt-3" style={{ color: 'var(--auth-faint)' }}>
            Times are {CONTRACT_TIME_ZONE.replace('America/', '')} venue time.
          </p>

          <div>
            <label className={labelClass} style={labelStyle}>
              INTERNAL NOTES
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Never shown to the counterparty."
              className={inputClass + ' resize-y'}
              style={inputStyle}
            />
          </div>

          {error && (
            <div className="text-[13px] text-red-400 p-3 rounded-[10px] border border-red-500/30 bg-red-500/10">
              {error}
            </div>
          )}

          {!error && !check.ok && templateId && (
            <div
              className="text-[12px] p-3 rounded-[10px] border"
              style={{
                background: 'var(--auth-warn-bg)',
                borderColor: 'var(--auth-warn-border)',
                color: 'var(--auth-warn)',
              }}
            >
              {check.error}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 pt-2 pb-6">
            <button
              type="submit"
              disabled={busy || !check.ok}
              className="flex-1 py-3.5 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all disabled:opacity-50"
              style={{ background: '#ffffff', color: '#0a0a0a' }}
            >
              {busy ? 'CREATING…' : 'CREATE DRAFT'}
            </button>
            <button
              type="button"
              onClick={() => !busy && onClose()}
              className="px-8 py-3.5 rounded-full text-[12px] font-semibold tracking-[0.16em] border transition-colors hover:bg-white/5"
              style={{ borderColor: 'var(--auth-card-border-strong)', color: 'var(--auth-text)' }}
            >
              CANCEL
            </button>
          </div>

          <p className="text-[11px] pb-6" style={{ color: 'var(--auth-faint)' }}>
            Creates a draft only. Nothing is sent until you review the fields and send it from the
            contract page.
          </p>
        </form>
      </div>
    </div>
  );
}
