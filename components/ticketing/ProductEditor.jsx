'use client';
import { useMemo, useState } from 'react';
import {
  T,
  cardStyle,
  fieldLabelStyle,
  inputStyle,
  pillClass,
  primaryPillStyle,
  ghostPillStyle,
  CheckboxRow,
  sectionHeaderStyle,
  sectionSubStyle,
  tableStyle,
  thStyle,
  tdStyle,
  statusPill,
} from './ticketingTheme.js';

// Inline product + tier editor.
//
// Themed to match the rest of the bananas admin (auth-* CSS vars, Plus Jakarta
// Sans, pill CTAs). All the underlying save/delete/reveal-threshold logic is
// unchanged from the previous version.

// ---- helpers ----
function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
function money(cents, currency = 'usd') {
  if (typeof cents !== 'number') return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
function centsToDollarInput(c) {
  return typeof c === 'number' ? (c / 100).toFixed(2) : '';
}
function dollarInputToCents(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function blankProduct(eventId) {
  return {
    id: null,
    event_id: eventId,
    name: '',
    description: '',
    member_only: false,
    min_per_order: 1,
    max_per_order: 10,
    capacity: null,
    display_order: 0,
    is_active: true,
    tier_reveal_threshold: 10,
    tiers: [
      {
        id: null,
        name: 'General',
        price_cents: 2000,
        starts_at: null,
        ends_at: null,
        is_active: true,
        display_order: 0,
        status: 'active',
        access_codes: [],
        booking_fee_cents_override: null,
      },
    ],
  };
}

function toEditShape(p) {
  return {
    ...p,
    description: p.description || '',
    tier_reveal_threshold: p.tier_reveal_threshold ?? null,
    capacity: p.capacity ?? null,
    tiers: (p.tiers || []).map((t) => ({
      ...t,
      access_codes: Array.isArray(t.access_codes) ? t.access_codes : [],
    })),
  };
}

// Compute a preview of which tier is currently "buyable" — mirrors
// selectActiveTier() from lib/tickets/pricing.js closely enough for a UI
// preview. Server is authoritative.
function resolveActiveTier(tiers, now = new Date()) {
  const buyable = tiers.filter((t) => t.is_active !== false && (t.status || 'active') === 'active');
  const hit = buyable.find((t) => {
    const s = t.starts_at ? new Date(t.starts_at) : null;
    const e = t.ends_at ? new Date(t.ends_at) : null;
    if (s && now < s) return false;
    if (e && now > e) return false;
    return true;
  });
  return hit || buyable[0] || null;
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'hidden', label: 'Hidden' },
  { value: 'sold_out', label: 'Sold out' },
  { value: 'access_code', label: 'Access code required' },
];

// ---- tier row ----
function TierRow({ tier, onChange, onDelete, canDelete, eventFeeDefault }) {
  const status = tier.status || 'active';
  const feePlaceholder = centsToDollarInput(eventFeeDefault ?? 295);

  return (
    <div
      style={{
        display: 'grid',
        gap: 8,
        gridTemplateColumns: 'minmax(140px, 1.4fr) 100px 170px 170px 150px 110px 32px',
        alignItems: 'center',
        padding: '10px 12px',
        borderBottom: `1px solid ${T.borderSoft}`,
        fontSize: 13,
        color: T.text,
        fontFamily: T.fontStack,
      }}
    >
      <input
        type="text"
        value={tier.name || ''}
        onChange={(e) => onChange({ ...tier, name: e.target.value })}
        placeholder="Early bird"
        style={inputStyle()}
      />
      <input
        type="number"
        min="0"
        step="0.01"
        value={centsToDollarInput(tier.price_cents)}
        onChange={(e) => {
          const c = dollarInputToCents(e.target.value);
          onChange({ ...tier, price_cents: c ?? 0 });
        }}
        style={inputStyle()}
        title="Price ($)"
      />
      <input
        type="datetime-local"
        value={isoToLocalInput(tier.starts_at)}
        onChange={(e) => onChange({ ...tier, starts_at: localInputToIso(e.target.value) })}
        title="Starts"
        style={inputStyle()}
      />
      <input
        type="datetime-local"
        value={isoToLocalInput(tier.ends_at)}
        onChange={(e) => onChange({ ...tier, ends_at: localInputToIso(e.target.value) })}
        title="Ends"
        style={inputStyle()}
      />
      <select
        value={status}
        onChange={(e) => onChange({ ...tier, status: e.target.value })}
        title="Status"
        style={inputStyle()}
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <input
        type="number"
        min="0"
        step="0.01"
        value={centsToDollarInput(tier.booking_fee_cents_override)}
        onChange={(e) => onChange({ ...tier, booking_fee_cents_override: dollarInputToCents(e.target.value) })}
        placeholder={feePlaceholder}
        title="Booking fee override ($). Blank = event default."
        style={inputStyle()}
      />
      <button
        type="button"
        onClick={onDelete}
        disabled={!canDelete}
        title={canDelete ? 'Remove tier' : 'Need at least one tier'}
        style={{
          border: 0,
          background: 'transparent',
          cursor: canDelete ? 'pointer' : 'default',
          fontSize: 20,
          color: canDelete ? T.danger : T.faint,
          padding: 4,
        }}
      >
        ×
      </button>
    </div>
  );
}

function AccessCodesInput({ tier, onChange }) {
  if ((tier.status || 'active') !== 'access_code') return null;
  const asString = (tier.access_codes || []).join(', ');
  return (
    <div style={{ padding: '10px 12px', fontSize: 12, background: T.innerBg, borderBottom: `1px solid ${T.borderSoft}` }}>
      <div style={{ color: T.muted, marginBottom: 6 }}>
        Access codes for “{tier.name || 'this tier'}” — comma-separated. Case-insensitive.
      </div>
      <input
        type="text"
        value={asString}
        onChange={(e) => {
          const codes = e.target.value
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean);
          onChange({ ...tier, access_codes: codes });
        }}
        placeholder="VIP2026, FRIENDS, PRESALE"
        style={inputStyle()}
      />
    </div>
  );
}

// ---- product form ----
function ProductForm({ eventId, initial, onSave, onCancel, saving, eventFeeDefault }) {
  const [p, setP] = useState(() => (initial ? toEditShape(initial) : blankProduct(eventId)));

  const activeTier = useMemo(() => resolveActiveTier(p.tiers), [p.tiers]);
  const nameValid = p.name.trim().length > 0;
  const tiersValid = p.tiers.length > 0 && p.tiers.every((t) =>
    t.name?.trim() &&
    Number.isFinite(t.price_cents) &&
    t.price_cents >= 0 &&
    (t.status !== 'access_code' || (t.access_codes && t.access_codes.length > 0))
  );
  const canSave = nameValid && tiersValid && !saving;

  function updateTier(index, next) {
    setP({ ...p, tiers: p.tiers.map((t, i) => (i === index ? next : t)) });
  }
  function addTier() {
    setP({
      ...p,
      tiers: [
        ...p.tiers,
        {
          id: null, name: '', price_cents: 2000,
          starts_at: null, ends_at: null,
          is_active: true, display_order: p.tiers.length,
          status: 'active', access_codes: [],
          booking_fee_cents_override: null,
        },
      ],
    });
  }
  function removeTier(index) {
    if (p.tiers.length <= 1) return;
    setP({ ...p, tiers: p.tiers.filter((_, i) => i !== index) });
  }

  function submit() {
    const payload = {
      ...p,
      name: p.name.trim(),
      description: p.description?.trim() || null,
      tier_reveal_threshold:
        p.tier_reveal_threshold === '' || p.tier_reveal_threshold === null || p.tier_reveal_threshold === undefined
          ? null
          : Number(p.tier_reveal_threshold),
      capacity:
        p.capacity === '' || p.capacity === null || p.capacity === undefined
          ? null
          : Number(p.capacity),
      tiers: p.tiers.map((t, i) => ({
        ...t,
        display_order: i,
        access_codes: t.status === 'access_code' ? (t.access_codes || []) : null,
      })),
    };
    onSave(payload);
  }

  return (
    <div style={{ ...cardStyle({ padding: 20 }), marginBottom: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        <label>
          <div style={fieldLabelStyle()}>Name *</div>
          <input
            type="text"
            value={p.name}
            onChange={(e) => setP({ ...p, name: e.target.value })}
            style={inputStyle({ invalid: !nameValid && p.name.length > 0 })}
            placeholder="General Admission"
          />
        </label>
        <label>
          <div style={fieldLabelStyle()}>Min per order</div>
          <input
            type="number"
            min="1"
            value={p.min_per_order}
            onChange={(e) => setP({ ...p, min_per_order: parseInt(e.target.value, 10) || 1 })}
            style={inputStyle()}
          />
        </label>
        <label>
          <div style={fieldLabelStyle()}>Max per order</div>
          <input
            type="number"
            min="1"
            value={p.max_per_order}
            onChange={(e) => setP({ ...p, max_per_order: parseInt(e.target.value, 10) || 1 })}
            style={inputStyle()}
          />
        </label>

        <label style={{ gridColumn: '1 / -1' }}>
          <div style={fieldLabelStyle()}>Description</div>
          <textarea
            rows={2}
            value={p.description}
            onChange={(e) => setP({ ...p, description: e.target.value })}
            style={{ ...inputStyle(), resize: 'vertical', minHeight: 60 }}
          />
        </label>

        <label>
          <div style={fieldLabelStyle()}>Total capacity (blank = unlimited)</div>
          <input
            type="number"
            min="0"
            value={p.capacity ?? ''}
            onChange={(e) => setP({ ...p, capacity: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
            style={inputStyle()}
          />
        </label>
        <label>
          <div style={fieldLabelStyle()}>Reveal next tier when current has ≤ (blank = show all)</div>
          <input
            type="number"
            min="0"
            value={p.tier_reveal_threshold ?? ''}
            onChange={(e) => setP({ ...p, tier_reveal_threshold: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
            style={inputStyle()}
            placeholder="10"
          />
        </label>
        <label>
          <div style={fieldLabelStyle()}>Sort order</div>
          <input
            type="number"
            value={p.display_order}
            onChange={(e) => setP({ ...p, display_order: parseInt(e.target.value, 10) || 0 })}
            style={inputStyle()}
          />
        </label>

        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 20, marginTop: 4 }}>
          <CheckboxRow
            checked={!!p.member_only}
            onChange={(v) => setP({ ...p, member_only: v })}
            label="Members only"
          />
          <CheckboxRow
            checked={p.is_active !== false}
            onChange={(v) => setP({ ...p, is_active: v })}
            label="Product active"
          />
        </div>
      </div>

      <h4 style={{ ...sectionHeaderStyle(), marginTop: 24, marginBottom: 4, fontSize: 12 }}>Price tiers</h4>
      <p style={sectionSubStyle()}>
        Each tier is a price window. Leave start/end blank for open-ended. Tiers are checked in order; the first Active tier whose window contains &quot;now&quot; wins. Booking fee override is per ticket in dollars — blank uses the event default.
      </p>

      <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, overflow: 'hidden', background: T.cardBg }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(140px, 1.4fr) 100px 170px 170px 150px 110px 32px',
            gap: 8,
            fontSize: 11,
            color: T.muted,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontWeight: 600,
            padding: '10px 12px',
            borderBottom: `1px solid ${T.border}`,
            background: T.innerBg,
            fontFamily: T.fontStack,
          }}
        >
          <span>Name</span>
          <span>Price $</span>
          <span>Starts</span>
          <span>Ends</span>
          <span>Status</span>
          <span>Fee $</span>
          <span />
        </div>
        {p.tiers.map((t, i) => (
          <div key={t.id || `new-${i}`}>
            <TierRow
              tier={t}
              onChange={(next) => updateTier(i, next)}
              onDelete={() => removeTier(i)}
              canDelete={p.tiers.length > 1}
              eventFeeDefault={eventFeeDefault}
            />
            <AccessCodesInput tier={t} onChange={(next) => updateTier(i, next)} />
          </div>
        ))}
        <div style={{ padding: '10px 12px', borderTop: `1px solid ${T.borderSoft}`, background: T.innerBg }}>
          <button
            type="button"
            onClick={addTier}
            className={pillClass()}
            style={ghostPillStyle()}
          >
            + ADD TIER
          </button>
        </div>
      </div>

      <div
        style={{
          marginTop: 16,
          padding: 14,
          background: T.innerBg,
          border: `1px solid ${T.borderSoft}`,
          borderRadius: 10,
          fontSize: 13,
          color: T.text,
          fontFamily: T.fontStack,
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.muted, marginBottom: 6 }}>
          Buyer preview
        </div>
        <div>
          {nameValid ? <strong style={{ color: T.strongText }}>{p.name}</strong> : <em style={{ color: T.faint }}>(name required)</em>}
          {p.member_only ? <span style={{ color: T.muted }}> · members only</span> : ''}
        </div>
        <div style={{ marginTop: 4 }}>
          Current price:{' '}
          {activeTier ? (
            <span>
              <strong style={{ color: T.strongText }}>{money(activeTier.price_cents)}</strong>
              {activeTier.name ? ` — ${activeTier.name}` : ''}
              {' · +'}
              {money(
                Number.isInteger(activeTier.booking_fee_cents_override)
                  ? activeTier.booking_fee_cents_override
                  : (eventFeeDefault ?? 295)
              )}
              {' booking fee'}
            </span>
          ) : (
            <em style={{ color: T.faint }}>no buyable tier right now (all hidden / sold out / gated)</em>
          )}
        </div>
      </div>

      <div style={{ marginTop: 20, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={submit}
          disabled={!canSave}
          className={pillClass('primary')}
          style={primaryPillStyle({ disabled: !canSave })}
        >
          {saving ? 'SAVING…' : (p.id ? 'SAVE CHANGES' : 'CREATE PRODUCT')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className={pillClass()}
          style={ghostPillStyle({ disabled: saving })}
        >
          CANCEL
        </button>
        {!nameValid && <span style={{ color: T.danger, fontSize: 12 }}>Name required</span>}
        {nameValid && !tiersValid && (
          <span style={{ color: T.danger, fontSize: 12 }}>
            Each tier needs a name, price, and if status is &quot;Access code required&quot;, at least one access code
          </span>
        )}
      </div>
    </div>
  );
}

// ---- top-level manager ----
export default function ProductEditor({ eventId, products, onReload, eventFeeDefault }) {
  const [editing, setEditing] = useState(null); // null | 'new' | product-id
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const target = editing === 'new' ? null : (products.find((p) => p.id === editing) || null);

  async function save(payload) {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch('/api/admin/tickets/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setEditing(null);
      await onReload();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function del(id) {
    if (!confirm('Delete this product? (Soft-deletes if any sales exist.)')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/tickets/products?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      await onReload();
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {err && (
        <div
          style={{
            color: T.danger,
            margin: '8px 0',
            padding: '8px 12px',
            border: `1px solid ${T.danger}`,
            borderRadius: 8,
            fontSize: 13,
            fontFamily: T.fontStack,
            background: 'rgba(249,112,102,0.08)',
          }}
        >
          {err}
        </div>
      )}

      {editing !== null ? (
        <ProductForm
          eventId={eventId}
          initial={target}
          onSave={save}
          onCancel={() => { setEditing(null); setErr(null); }}
          saving={saving}
          eventFeeDefault={eventFeeDefault}
        />
      ) : (
        <div style={{ marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className={pillClass('primary')}
            style={primaryPillStyle()}
          >
            + NEW PRODUCT
          </button>
        </div>
      )}

      <table style={tableStyle()}>
        <thead>
          <tr>
            <th style={thStyle()}>Name</th>
            <th style={thStyle()}>Tiers</th>
            <th style={thStyle({ align: 'right' })}>Inventory</th>
            <th style={thStyle()}>Flags</th>
            <th style={thStyle({ align: 'right' })}></th>
          </tr>
        </thead>
        <tbody>
          {products.length === 0 && (
            <tr>
              <td colSpan={5} style={{ ...tdStyle(), color: T.muted, textAlign: 'center' }}>
                No products yet. Click &quot;+ NEW PRODUCT&quot; to create one.
              </td>
            </tr>
          )}
          {products.map((p) => {
            const active = resolveActiveTier(p.tiers || []);
            const totalTiers = (p.tiers || []).length;
            const hiddenCount = (p.tiers || []).filter((t) => (t.status || 'active') === 'hidden').length;
            const codeGated = (p.tiers || []).filter((t) => (t.status || 'active') === 'access_code').length;
            const soldOutTiers = (p.tiers || []).filter((t) => (t.status || 'active') === 'sold_out').length;
            return (
              <tr key={p.id}>
                <td style={tdStyle()}>
                  <div style={{ fontWeight: 700, color: T.strongText }}>{p.name}</div>
                  {p.description && <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{p.description}</div>}
                </td>
                <td style={tdStyle()}>
                  <div>{totalTiers} tier{totalTiers === 1 ? '' : 's'}</div>
                  {active && (
                    <div style={{ fontSize: 12, color: T.accent, marginTop: 2 }}>
                      Now: {money(active.price_cents)} — {active.name}
                    </div>
                  )}
                  {(hiddenCount || codeGated || soldOutTiers) ? (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {hiddenCount ? <span style={statusPill({ tone: 'muted' })}>{hiddenCount} hidden</span> : null}
                      {codeGated ? <span style={statusPill({ tone: 'accent' })}>{codeGated} code-gated</span> : null}
                      {soldOutTiers ? <span style={statusPill({ tone: 'warning' })}>{soldOutTiers} sold out</span> : null}
                    </div>
                  ) : null}
                </td>
                <td style={tdStyle({ align: 'right' })}>
                  <div style={{ fontWeight: 600 }}>{typeof p.capacity === 'number' ? p.capacity : '∞'}</div>
                  <div style={{ fontSize: 12, color: T.muted }}>{p.sold_count || 0} sold · {p.reserved_count || 0} held</div>
                </td>
                <td style={tdStyle()}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {p.is_active === false && <span style={statusPill({ tone: 'danger' })}>Inactive</span>}
                    {p.member_only && <span style={statusPill({ tone: 'accent' })}>Members</span>}
                    {typeof p.tier_reveal_threshold === 'number' && (
                      <span style={statusPill({ tone: 'muted' })}>reveal ≤ {p.tier_reveal_threshold}</span>
                    )}
                  </div>
                </td>
                <td style={tdStyle({ align: 'right' })}>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => setEditing(p.id)}
                      disabled={saving}
                      className={pillClass()}
                      style={ghostPillStyle({ disabled: saving })}
                    >
                      EDIT
                    </button>
                    <button
                      type="button"
                      onClick={() => del(p.id)}
                      disabled={saving}
                      className={pillClass()}
                      style={ghostPillStyle({ disabled: saving, danger: true })}
                    >
                      DELETE
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
