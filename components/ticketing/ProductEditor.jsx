'use client';
import { useMemo, useState } from 'react';

// Inline product + tier editor.
//
// New in v2:
//   - Per-tier status dropdown: Active / Hidden / Sold Out / Access Code
//   - Access-code textarea (comma-separated) when status='access_code'
//   - Per-tier booking-fee override (leave blank to use event default)
//   - Product-level tier_reveal_threshold ("hide later tiers until current
//     has N left"). Blank = show all tiers always.
//   - Per-product capacity (writes to ticket_inventory)
//
// Booking-fee amounts are entered in dollars for the human, converted to
// cents on save. Access codes stored uppercased.

// Local datetime <-> ISO helpers.
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

function TierRow({ tier, onChange, onDelete, canDelete, eventFeeDefault }) {
  const status = tier.status || 'active';
  const feePlaceholder = centsToDollarInput(eventFeeDefault ?? 295);

  return (
    <div
      style={{
        display: 'grid',
        gap: 8,
        gridTemplateColumns: 'minmax(140px, 1.4fr) 90px 160px 160px 140px 100px 40px',
        alignItems: 'center',
        padding: '8px 0',
        borderBottom: '1px solid #eee',
        fontSize: 13,
      }}
    >
      <input
        type="text"
        value={tier.name || ''}
        onChange={(e) => onChange({ ...tier, name: e.target.value })}
        placeholder="Early bird"
        style={{ width: '100%' }}
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
        style={{ width: '100%' }}
        title="Price ($)"
      />
      <input
        type="datetime-local"
        value={isoToLocalInput(tier.starts_at)}
        onChange={(e) => onChange({ ...tier, starts_at: localInputToIso(e.target.value) })}
        title="Starts"
      />
      <input
        type="datetime-local"
        value={isoToLocalInput(tier.ends_at)}
        onChange={(e) => onChange({ ...tier, ends_at: localInputToIso(e.target.value) })}
        title="Ends"
      />
      <select
        value={status}
        onChange={(e) => onChange({ ...tier, status: e.target.value })}
        title="Status"
        style={{ width: '100%' }}
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
        style={{ width: '100%' }}
      />
      <button
        type="button"
        onClick={onDelete}
        disabled={!canDelete}
        title={canDelete ? 'Remove tier' : 'Need at least one tier'}
        style={{ border: 0, background: 'transparent', cursor: canDelete ? 'pointer' : 'default', fontSize: 16 }}
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
    <div style={{ padding: '8px 0', fontSize: 12 }}>
      <div style={{ color: '#666', marginBottom: 4 }}>
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
        style={{ width: '100%', padding: 6 }}
      />
    </div>
  );
}

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
    <div style={{ border: '1px solid #ddd', padding: 16, marginBottom: 20, borderRadius: 6, background: '#fafafa' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <label>
          <div style={{ fontSize: 12, color: '#666' }}>Name *</div>
          <input type="text" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} style={{ width: '100%' }} placeholder="General Admission" />
        </label>
        <label>
          <div style={{ fontSize: 12, color: '#666' }}>Min per order</div>
          <input type="number" min="1" value={p.min_per_order} onChange={(e) => setP({ ...p, min_per_order: parseInt(e.target.value, 10) || 1 })} style={{ width: '100%' }} />
        </label>
        <label>
          <div style={{ fontSize: 12, color: '#666' }}>Max per order</div>
          <input type="number" min="1" value={p.max_per_order} onChange={(e) => setP({ ...p, max_per_order: parseInt(e.target.value, 10) || 1 })} style={{ width: '100%' }} />
        </label>
        <label style={{ gridColumn: '1 / -1' }}>
          <div style={{ fontSize: 12, color: '#666' }}>Description</div>
          <textarea rows={2} value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} style={{ width: '100%' }} />
        </label>
        <label>
          <div style={{ fontSize: 12, color: '#666' }}>Total capacity (blank = unlimited)</div>
          <input
            type="number"
            min="0"
            value={p.capacity ?? ''}
            onChange={(e) => setP({ ...p, capacity: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
            style={{ width: '100%' }}
          />
        </label>
        <label>
          <div style={{ fontSize: 12, color: '#666' }}>
            Reveal next tier when current has ≤ (blank = show all)
          </div>
          <input
            type="number"
            min="0"
            value={p.tier_reveal_threshold ?? ''}
            onChange={(e) => setP({ ...p, tier_reveal_threshold: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
            style={{ width: '100%' }}
            placeholder="10"
          />
        </label>
        <label>
          <div style={{ fontSize: 12, color: '#666' }}>Sort order</div>
          <input type="number" value={p.display_order} onChange={(e) => setP({ ...p, display_order: parseInt(e.target.value, 10) || 0 })} style={{ width: '100%' }} />
        </label>
        <label>
          <input type="checkbox" checked={!!p.member_only} onChange={(e) => setP({ ...p, member_only: e.target.checked })} /> Members only
        </label>
        <label>
          <input type="checkbox" checked={p.is_active !== false} onChange={(e) => setP({ ...p, is_active: e.target.checked })} /> Product active
        </label>
      </div>

      <h4 style={{ marginTop: 20, marginBottom: 4 }}>Price tiers</h4>
      <p style={{ margin: '0 0 8px 0', fontSize: 12, color: '#666' }}>
        Each tier is a price window. Leave start/end blank for open-ended. Tiers are checked in order; the first Active tier whose window contains &quot;now&quot; wins.
        Booking fee override is per ticket in dollars — blank uses the event default.
      </p>
      <div style={{ display: 'grid', gap: 4 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(140px, 1.4fr) 90px 160px 160px 140px 100px 40px',
            gap: 8,
            fontSize: 11,
            color: '#666',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            padding: '4px 0',
            borderBottom: '1px solid #ddd',
          }}
        >
          <span>Name</span>
          <span>Price $</span>
          <span>Starts</span>
          <span>Ends</span>
          <span>Status</span>
          <span>Fee override $</span>
          <span></span>
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
      </div>
      <button type="button" onClick={addTier} style={{ marginTop: 6 }}>+ Add tier</button>

      <div style={{ marginTop: 16, padding: 10, background: '#f6f9ff', border: '1px solid #d5e0f7', borderRadius: 4, fontSize: 13 }}>
        <strong>Buyer preview</strong>
        <div style={{ marginTop: 4 }}>
          {nameValid ? p.name : <em style={{ color: '#999' }}>(name required)</em>}
          {p.member_only ? ' · members only' : ''}
        </div>
        <div>
          Current price:{' '}
          {activeTier ? (
            <span>
              <strong>{money(activeTier.price_cents)}</strong>
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
            <em style={{ color: '#999' }}>no buyable tier right now (all hidden / sold out / gated)</em>
          )}
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button type="button" onClick={submit} disabled={!canSave}>{saving ? 'Saving…' : (p.id ? 'Save changes' : 'Create product')}</button>
        <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
        {!nameValid && <span style={{ color: '#a00', fontSize: 12, alignSelf: 'center' }}>Name required</span>}
        {nameValid && !tiersValid && (
          <span style={{ color: '#a00', fontSize: 12, alignSelf: 'center' }}>
            Each tier needs a name, price, and if status is &quot;Access code required&quot;, at least one access code
          </span>
        )}
      </div>
    </div>
  );
}

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
      {err && <div style={{ color: '#a00', margin: '8px 0' }}>{err}</div>}

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
        <button type="button" onClick={() => setEditing('new')} style={{ marginBottom: 12 }}>+ New product</button>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #ccc' }}>
            <th align="left">Name</th>
            <th align="left">Tiers</th>
            <th align="right">Inventory</th>
            <th align="left">Flags</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {products.length === 0 && (
            <tr><td colSpan={5} style={{ padding: 12, color: '#666' }}>No products yet. Click &quot;New product&quot; to create one.</td></tr>
          )}
          {products.map((p) => {
            const active = resolveActiveTier(p.tiers || []);
            const totalTiers = (p.tiers || []).length;
            const hiddenCount = (p.tiers || []).filter((t) => (t.status || 'active') === 'hidden').length;
            const codeGated = (p.tiers || []).filter((t) => (t.status || 'active') === 'access_code').length;
            const soldOutTiers = (p.tiers || []).filter((t) => (t.status || 'active') === 'sold_out').length;
            return (
              <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                <td>
                  <div><strong>{p.name}</strong></div>
                  {p.description && <div style={{ fontSize: 12, color: '#666' }}>{p.description}</div>}
                </td>
                <td>
                  {totalTiers} tier{totalTiers === 1 ? '' : 's'}
                  {active && <div style={{ fontSize: 12, color: '#083' }}>Now: {money(active.price_cents)} — {active.name}</div>}
                  {(hiddenCount || codeGated || soldOutTiers) ? (
                    <div style={{ fontSize: 11, color: '#888' }}>
                      {hiddenCount ? `${hiddenCount} hidden ` : ''}
                      {codeGated ? `${codeGated} code-gated ` : ''}
                      {soldOutTiers ? `${soldOutTiers} sold out` : ''}
                    </div>
                  ) : null}
                </td>
                <td align="right">
                  {typeof p.capacity === 'number' ? p.capacity : '∞'}
                  <div style={{ fontSize: 12, color: '#666' }}>{p.sold_count || 0} sold · {p.reserved_count || 0} held</div>
                </td>
                <td>
                  {p.is_active === false && <span style={{ color: '#a00' }}>inactive </span>}
                  {p.member_only && <span>members only </span>}
                  {typeof p.tier_reveal_threshold === 'number' && (
                    <span style={{ fontSize: 11, color: '#666' }}>reveal @≤{p.tier_reveal_threshold}</span>
                  )}
                </td>
                <td>
                  <button type="button" onClick={() => setEditing(p.id)} disabled={saving}>Edit</button>{' '}
                  <button type="button" onClick={() => del(p.id)} disabled={saving}>Delete</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
