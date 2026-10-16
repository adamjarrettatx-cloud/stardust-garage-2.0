'use client';

import { useMemo, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { createClient } from '@/lib/supabase/client';
import { computeSettlement, PROOF_MAX_BYTES, PROOF_MIME } from '@/lib/event-writeup';
import OrganizerWriteup from '@/app/components/OrganizerWriteup';

const CARD = { background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' };
const INPUT_STYLE = { background: 'var(--auth-input-bg)', border: '1px solid var(--auth-input-border)', color: 'var(--auth-input-text)' };
const MUTED = 'var(--auth-muted)';
const TEXT = 'var(--auth-text)';
const STRONG = 'var(--auth-text-strong)';
const ROW_BORDER = '1px solid var(--auth-row-border)';
const SECTION = 'text-[11px] font-semibold tracking-[0.14em] uppercase';

function usd(cents) {
  const n = Number(cents) || 0;
  return (n / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
function minus(cents) {
  return cents ? `-${usd(Math.abs(cents))}` : usd(0);
}
function pct(bps) {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}
function toCents(str) {
  const s = String(str ?? '').replace(/[$,\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}
function centsToInput(cents) {
  if (cents == null) return '';
  return (Number(cents) / 100).toFixed(2);
}
function newId() {
  return `adj_${Math.random().toString(36).slice(2, 10)}`;
}

function Row({ label, value, bold = false, top = true }) {
  return (
    <div
      className={`flex items-center justify-between gap-4 py-2 ${bold ? 'text-[15px] font-bold' : 'text-[13px]'}`}
      style={{ borderTop: top ? ROW_BORDER : 'none' }}
    >
      <span style={{ color: bold ? STRONG : MUTED }}>{label}</span>
      <span className="tabular-nums text-right" style={{ color: bold ? STRONG : TEXT }}>{value}</span>
    </div>
  );
}

function Card({ title, subtitle, children }) {
  return (
    <section className="rounded-[8px] border p-5" style={CARD}>
      <div className="mb-3">
        <h2 className={SECTION} style={{ color: STRONG }}>{title}</h2>
        {subtitle ? <p className="text-[12px] mt-1" style={{ color: MUTED }}>{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function pick(json) {
  return {
    event: json.event,
    config: json.config,
    writeup: json.writeup,
    proofs: json.proofs || [],
    organizer: json.organizer || null,
    sharing: json.sharing || { shared: false, shared_at: null, outdated: false },
    organizerPreview: json.organizerPreview || null,
  };
}

function fmtTime(v) {
  return new Date(v).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function WriteupClient({ eventId, initial }) {
  const [data, setData] = useState(() => pick(initial));
  const [uploading, setUploading] = useState(false);
  const [proofMsg, setProofMsg] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [shareMsg, setShareMsg] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const fileRef = useRef(null);
  const online = data.writeup.online;
  const isTicketTailor = online.source === 'tickettailor';

  const [doorGross, setDoorGross] = useState(centsToInput(data.config.door_gross_cents));
  const [orgPct, setOrgPct] = useState(data.config.organizer_percent == null ? '' : String(data.config.organizer_percent));
  const [items, setItems] = useState(() => (data.config.adjustments || []).map((a) => ({
    id: a.id || newId(),
    label: a.label,
    direction: a.amount_cents < 0 ? 'charge' : 'pay',
    amount: centsToInput(Math.abs(a.amount_cents)),
  })));
  const [notes, setNotes] = useState(data.config.notes || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [dirty, setDirty] = useState(false);

  const doorCents = toCents(doorGross);
  const pctNum = orgPct.trim() === '' ? null : Number(orgPct);
  const itemCents = items.map((it) => {
    const c = toCents(it.amount);
    return Number.isFinite(c) ? (it.direction === 'charge' ? -Math.abs(c) : Math.abs(c)) : 0;
  });

  const invalid = Number.isNaN(doorCents) || (pctNum != null && (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100))
    || items.some((it) => Number.isNaN(toCents(it.amount)));

  const live = useMemo(() => computeSettlement(online, {
    ...data.config,
    door_gross_cents: Number.isFinite(doorCents) ? doorCents : null,
    organizer_percent: Number.isFinite(pctNum) ? pctNum : null,
    adjustments: items.map((it, i) => ({ id: it.id, label: it.label || 'Line item', amount_cents: itemCents[i] })),
  }), [online, data.config, doorCents, pctNum, items, itemCents]);

  function touch(fn) {
    return (...args) => { setDirty(true); setMsg(null); fn(...args); };
  }
  const updateItem = touch((id, patch) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it))));
  const addItem = touch(() => setItems((list) => [...list, { id: newId(), label: '', direction: 'pay', amount: '' }]));
  const removeItem = touch((id) => setItems((list) => list.filter((it) => it.id !== id)));

  async function save() {
    if (invalid) { setMsg({ error: true, text: 'Check the highlighted amounts.' }); return; }
    if (items.some((it) => !it.label.trim() && toCents(it.amount))) {
      setMsg({ error: true, text: 'Every line item needs a name.' });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const json = await adminFetch(`/api/admin/events/${eventId}/writeup`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          door_gross_cents: doorCents,
          organizer_percent: pctNum,
          adjustments: items
            .filter((it) => it.label.trim() || toCents(it.amount))
            .map((it) => ({ id: it.id, label: it.label.trim(), amount_cents: itemCents[items.indexOf(it)] })),
          notes,
        }),
      });
      setData(pick(json));
      setDirty(false);
      setMsg({ error: false, text: 'Saved.' });
    } catch (err) {
      setMsg({ error: true, text: err.message || 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  async function uploadProofs(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true);
    setProofMsg(null);
    try {
      const supabase = createClient();
      let latest = null;
      for (const file of files) {
        if (!PROOF_MIME[file.type]) throw new Error(`${file.name}: upload a PNG, JPG, WEBP or HEIC image.`);
        if (file.size > PROOF_MAX_BYTES) throw new Error(`${file.name}: images must be 15 MB or smaller.`);
        const signed = await adminFetch(`/api/admin/events/${eventId}/writeup/proofs/upload-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content_type: file.type, size: file.size }),
        });
        const { error: upErr } = await supabase.storage
          .from(signed.bucket)
          .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
        if (upErr) throw new Error(upErr.message || 'Upload failed');
        latest = await adminFetch(`/api/admin/events/${eventId}/writeup/proofs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: signed.path, name: file.name }),
        });
      }
      if (latest) setData(pick(latest));
      setProofMsg({ error: false, text: files.length > 1 ? 'Screenshots uploaded.' : 'Screenshot uploaded.' });
    } catch (err) {
      setProofMsg({ error: true, text: err.message || 'Upload failed' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeProof(proofId) {
    if (!window.confirm('Remove this screenshot? The organizer will no longer be able to view it.')) return;
    setProofMsg(null);
    try {
      const json = await adminFetch(`/api/admin/events/${eventId}/writeup/proofs/${proofId}`, { method: 'DELETE' });
      setData(pick(json));
    } catch (err) {
      setProofMsg({ error: true, text: err.message || 'Remove failed' });
    }
  }

  async function share(action) {
    if (action === 'share' && dirty) { setShareMsg({ error: true, text: 'Save the write-up first.' }); return; }
    if (action === 'unshare' && !window.confirm('Stop sharing? The organizer will no longer see this settlement.')) return;
    setSharing(true);
    setShareMsg(null);
    try {
      const json = await adminFetch(`/api/admin/events/${eventId}/writeup/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      setData(pick(json));
      setShareMsg({ error: false, text: action === 'share' ? 'Shared with organizer.' : 'No longer shared.' });
    } catch (err) {
      setShareMsg({ error: true, text: err.message || 'Could not update sharing' });
    } finally {
      setSharing(false);
    }
  }

  function summaryText() {
    const o = live.online;
    const d = live.door;
    const lines = [
      `${data.event.title} — Financial Write-Up`,
      '',
      ...(o.source === 'tickettailor' ? [
        `Ticket Tailor tickets (${o.ticketsSold} sold)`,
        `  Gross revenue: ${usd(o.grossCents)}`,
        `  Ticket Tailor fees: ${minus(o.ticketTailorFeesCents)}`,
        `  Per-ticket fee (${usd(o.perTicketFeeCents)} × ${o.ticketsSold}): ${minus(o.perTicketFeesTotalCents)}`,
        `  Net: ${usd(o.netCents)}`,
      ] : [
        `sdgatx.com tickets (${o.ticketsSold} sold)`,
        `  Gross revenue: ${usd(o.grossCents)}`,
        ...(o.refundsCents ? [`  Refunds: ${minus(o.refundsCents)}`] : []),
        `  Sales tax (8.25%): ${minus(o.salesTaxCents)}`,
        `  Stripe fees (${pct(o.stripePctBps)} + ${o.stripeFixedCents}¢ × ${o.transactions} transactions): ${minus(o.stripeFeesCents)}`,
        `  Booking fees (100% Stardust Garage): ${minus(o.bookingFeesCents)}`,
        `  Net: ${usd(o.netCents)}`,
      ]),
      '',
      'Door sales',
      `  Gross revenue: ${usd(d.grossCents)}`,
      `  Sales tax (${pct(d.salesTaxBps)}): ${minus(d.salesTaxCents)}`,
      `  CC fees (${pct(d.ccFeeBps)}): ${minus(d.ccFeesCents)}`,
      `  Net: ${usd(d.netCents)}`,
      '',
      `Net ticket revenue: ${usd(live.netTicketRevenueCents)}`,
    ];
    if (live.organizerPercent != null) lines.push(`${live.organizerPercent}% to organizer: ${usd(live.grossPayoutCents)}`);
    for (const a of live.adjustments) lines.push(`${a.label}: ${a.amount_cents < 0 ? minus(a.amount_cents) : usd(a.amount_cents)}`);
    lines.push(`Net payout to organizer: ${usd(live.netPayoutCents)}`);
    return lines.join('\n');
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summaryText());
      setMsg({ error: false, text: 'Write-up copied.' });
    } catch {
      setMsg({ error: true, text: 'Could not copy.' });
    }
  }

  const o = live.online;
  const d = live.door;
  const doorInvalid = Number.isNaN(doorCents);
  const pctInvalid = pctNum != null && (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        {isTicketTailor ? (
          <Card
            title={`Ticket Tailor tickets · ${o.ticketsSold} sold`}
            subtitle={`Final Ticket Tailor record${o.frozenAt ? ` as of ${new Date(o.frozenAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}` : ''} · no longer synced`}
          >
            <Row top={false} label="Gross revenue" value={usd(o.grossCents)} />
            <Row label="Ticket Tailor fees" value={minus(o.ticketTailorFeesCents)} />
            <Row label={`Per-ticket fee (${usd(o.perTicketFeeCents)} × ${o.ticketsSold})`} value={minus(o.perTicketFeesTotalCents)} />
            <Row bold label="Net online" value={usd(o.netCents)} />
            {o.snapshotStatus && o.snapshotStatus !== 'ok' ? (
              <p className="text-[12px] mt-2" style={{ color: 'var(--auth-pink)' }}>
                The last Ticket Tailor sync did not finish cleanly. Check these numbers against Ticket Tailor.
              </p>
            ) : null}
          </Card>
        ) : (
          <Card
            title={`sdgatx.com tickets · ${o.ticketsSold} sold`}
            subtitle={`${o.transactions} transactions · totaled live from orders`}
          >
            <Row top={false} label="Gross revenue" value={usd(o.grossCents)} />
            {o.refundsCents ? <Row label="Refunds" value={minus(o.refundsCents)} /> : null}
            <Row label="Sales tax (8.25%, as collected)" value={minus(o.salesTaxCents)} />
            <Row label={`Stripe fees (${pct(o.stripePctBps)} + ${o.stripeFixedCents}¢ per transaction)`} value={minus(o.stripeFeesCents)} />
            <Row label="Booking fees (100% Stardust Garage)" value={minus(o.bookingFeesCents)} />
            <Row bold label="Net online" value={usd(o.netCents)} />
          </Card>
        )}

        <Card title="Door sales" subtitle="Enter gross door sales from the POS dashboard.">
          <label className="flex items-center justify-between gap-4 pb-2 text-[13px]">
            <span style={{ color: MUTED }}>Gross revenue</span>
            <span className="flex items-center gap-1">
              <span style={{ color: MUTED }}>$</span>
              <input
                inputMode="decimal"
                value={doorGross}
                onChange={(e) => touch(setDoorGross)(e.target.value)}
                placeholder="0.00"
                aria-label="Door gross revenue"
                className="w-[130px] rounded-[6px] px-2.5 py-1.5 text-right tabular-nums text-[13px]"
                style={{ ...INPUT_STYLE, borderColor: doorInvalid ? 'var(--auth-pink)' : INPUT_STYLE.border }}
              />
            </span>
          </label>
          <Row label={`Sales tax (${pct(d.salesTaxBps)})`} value={minus(d.salesTaxCents)} />
          <Row label={`CC fees (${pct(d.ccFeeBps)})`} value={minus(d.ccFeesCents)} />
          <Row bold label="Net door" value={usd(d.netCents)} />

          <div className="pt-3 mt-1" style={{ borderTop: ROW_BORDER }}>
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className={SECTION} style={{ color: MUTED }}>POS proof</span>
              <label className={`auth-theme-border-button px-3 py-1.5 rounded-[8px] text-[11px] font-semibold tracking-[0.12em] border cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                {uploading ? 'UPLOADING…' : '+ UPLOAD SCREENSHOT'}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
                  multiple
                  className="sr-only"
                  onChange={(e) => uploadProofs(e.target.files)}
                />
              </label>
            </div>
            {data.proofs.length === 0 ? (
              <p className="text-[12px]" style={{ color: MUTED }}>Upload a screenshot of the POS ticket sales. The organizer can open it from their settlement.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.proofs.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 text-[13px]">
                    <a
                      href={`/api/admin/events/${eventId}/writeup/proofs/${p.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate underline underline-offset-2"
                      style={{ color: TEXT }}
                    >
                      {p.name}
                    </a>
                    <span className="flex items-center gap-3 shrink-0">
                      <span className="text-[12px]" style={{ color: MUTED }}>{fmtTime(p.uploaded_at)}</span>
                      <button type="button" onClick={() => removeProof(p.id)} title="Remove screenshot" aria-label={`Remove ${p.name}`} className="auth-theme-border-button px-2 py-1 rounded-[8px] text-[11px] border">✕</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {proofMsg ? <p className="text-[12px] mt-2" style={{ color: proofMsg.error ? 'var(--auth-pink)' : 'var(--auth-success)' }}>{proofMsg.text}</p> : null}
          </div>
        </Card>
      </div>

      <Card title="Organizer payout" subtitle="Leave the percentage blank for events without an outside organizer.">
        <Row top={false} label="Net ticket revenue (online + door)" value={usd(live.netTicketRevenueCents)} />
        <div className="flex items-center justify-between gap-4 py-2 text-[13px]" style={{ borderTop: ROW_BORDER }}>
          <span className="flex items-center gap-2" style={{ color: MUTED }}>
            Organizer gets
            <input
              inputMode="decimal"
              value={orgPct}
              onChange={(e) => touch(setOrgPct)(e.target.value)}
              placeholder="0"
              aria-label="Organizer percentage of net ticket revenue"
              className="w-[64px] rounded-[6px] px-2 py-1 text-right tabular-nums text-[13px]"
              style={{ ...INPUT_STYLE, borderColor: pctInvalid ? 'var(--auth-pink)' : INPUT_STYLE.border }}
            />
            % of net ticket revenue
          </span>
        </div>
        <Row label="Gross payout to organizer" value={usd(live.grossPayoutCents)} />

        <div className="pt-3 pb-1" style={{ borderTop: ROW_BORDER }}>
          <div className="flex items-center justify-between mb-2">
            <span className={SECTION} style={{ color: MUTED }}>Line items</span>
            <button
              type="button"
              onClick={addItem}
              className="auth-theme-border-button px-3 py-1.5 rounded-[8px] text-[11px] font-semibold tracking-[0.12em] border"
            >
              + ADD LINE ITEM
            </button>
          </div>
          {items.length === 0 ? (
            <p className="text-[12px] py-1" style={{ color: MUTED }}>Artist pay, bar tab, extra staffing, deposits and other payments or charges.</p>
          ) : (
            <div className="space-y-2">
              {items.map((it) => {
                const bad = Number.isNaN(toCents(it.amount));
                return (
                  <div key={it.id} className="flex flex-wrap items-center gap-2">
                    <input
                      value={it.label}
                      onChange={(e) => updateItem(it.id, { label: e.target.value })}
                      placeholder="Line item name"
                      aria-label="Line item name"
                      className="flex-1 min-w-[160px] rounded-[6px] px-2.5 py-1.5 text-[13px]"
                      style={INPUT_STYLE}
                    />
                    <select
                      value={it.direction}
                      onChange={(e) => updateItem(it.id, { direction: e.target.value })}
                      aria-label="Adds to or subtracts from payout"
                      className="rounded-[6px] px-2 py-1.5 text-[13px]"
                      style={INPUT_STYLE}
                    >
                      <option value="pay">+ Add to payout</option>
                      <option value="charge">− Subtract from payout</option>
                    </select>
                    <span className="flex items-center gap-1">
                      <span style={{ color: MUTED }}>$</span>
                      <input
                        inputMode="decimal"
                        value={it.amount}
                        onChange={(e) => updateItem(it.id, { amount: e.target.value })}
                        placeholder="0.00"
                        aria-label="Line item amount"
                        className="w-[110px] rounded-[6px] px-2.5 py-1.5 text-right tabular-nums text-[13px]"
                        style={{ ...INPUT_STYLE, borderColor: bad ? 'var(--auth-pink)' : INPUT_STYLE.border }}
                      />
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(it.id)}
                      title="Remove line item"
                      aria-label="Remove line item"
                      className="auth-theme-border-button px-2.5 py-1.5 rounded-[8px] text-[12px] border"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Row bold label="Net payout to organizer" value={usd(live.netPayoutCents)} />
      </Card>

      <Card title="Stardust Garage keeps" subtitle="Admin only. Never shown to the organizer.">
        <Row top={false} label="Net ticket revenue after organizer payout" value={usd(live.netTicketRevenueCents - live.netPayoutCents)} />
        {isTicketTailor ? null : <Row label="Booking fees" value={usd(o.bookingFeesCents)} />}
        <Row bold label="Total to Stardust Garage" value={usd(live.stardustKeepsCents)} />
      </Card>

      <Card title="Internal notes" subtitle="Never shown to the organizer.">
        <textarea
          value={notes}
          onChange={(e) => touch(setNotes)(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Optional internal notes"
          aria-label="Notes"
          className="w-full rounded-[6px] px-3 py-2 text-[13px]"
          style={INPUT_STYLE}
        />
      </Card>

      <Card
        title="Organizer view"
        subtitle={data.organizer
          ? `Visible to ${data.organizer.name} and its main contacts in their portal, only after you share. They see the online, door and payout figures and POS proof, never what Stardust Garage keeps.`
          : 'No Organizer is set on this event. Set one in the event editor to share this write-up.'}
      >
        <div className="flex flex-wrap items-center gap-3">
          {data.sharing.shared ? (
            <>
              <span className="text-[13px]" style={{ color: data.sharing.outdated ? 'var(--auth-warn)' : 'var(--auth-success)' }}>
                {data.sharing.outdated
                  ? `Shared ${fmtTime(data.sharing.shared_at)} · numbers changed since, the organizer still sees the shared version`
                  : `Shared ${fmtTime(data.sharing.shared_at)}`}
              </span>
              {data.sharing.outdated ? (
                <button type="button" onClick={() => share('share')} disabled={sharing || !data.organizer} className="auth-theme-solid-button px-4 py-2 rounded-[8px] text-[11px] font-semibold tracking-[0.12em] disabled:opacity-50">UPDATE SHARED VERSION</button>
              ) : null}
              <button type="button" onClick={() => share('unshare')} disabled={sharing} className="auth-theme-border-button px-4 py-2 rounded-[8px] text-[11px] font-semibold tracking-[0.12em] border disabled:opacity-50">STOP SHARING</button>
            </>
          ) : (
            <button type="button" onClick={() => share('share')} disabled={sharing || !data.organizer} className="auth-theme-solid-button px-4 py-2 rounded-[8px] text-[11px] font-semibold tracking-[0.12em] disabled:opacity-50">SHARE WITH ORGANIZER</button>
          )}
          <button type="button" onClick={() => setShowPreview((v) => !v)} className="auth-theme-border-button px-4 py-2 rounded-[8px] text-[11px] font-semibold tracking-[0.12em] border">
            {showPreview ? 'HIDE PREVIEW' : 'PREVIEW ORGANIZER VIEW'}
          </button>
          {shareMsg ? <span className="text-[12px]" style={{ color: shareMsg.error ? 'var(--auth-pink)' : 'var(--auth-success)' }}>{shareMsg.text}</span> : null}
        </div>
        {showPreview ? (
          <div className="mt-4 rounded-[8px] p-5" style={{ background: '#0f0e0c', border: '1px solid #39362f' }}>
            {dirty ? <p className="text-[12px] mb-2" style={{ color: 'var(--auth-warn)' }}>Preview reflects the last saved values. Save to update it.</p> : null}
            <OrganizerWriteup
              view={data.organizerPreview}
              proofs={data.proofs}
              proofHref={(proofId) => `/api/admin/events/${eventId}/writeup/proofs/${proofId}`}
            />
          </div>
        ) : null}
      </Card>

      <div className="flex flex-wrap items-center gap-3 pb-8">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="auth-theme-solid-button px-5 py-2.5 rounded-[8px] text-[11px] font-semibold tracking-[0.12em] disabled:opacity-50"
        >
          {saving ? 'SAVING…' : 'SAVE WRITE-UP'}
        </button>
        <button
          type="button"
          onClick={copySummary}
          className="auth-theme-border-button px-4 py-2.5 rounded-[8px] text-[11px] font-semibold tracking-[0.12em] border"
        >
          COPY WRITE-UP
        </button>
        {msg ? <span className="text-[12px]" style={{ color: msg.error ? 'var(--auth-pink)' : 'var(--auth-success)' }}>{msg.text}</span> : null}
        {data.config.updated_at && !dirty ? (
          <span className="text-[12px]" style={{ color: MUTED }}>
            Last saved {new Date(data.config.updated_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
