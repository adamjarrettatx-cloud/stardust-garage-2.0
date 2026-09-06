'use client';
import { useMemo, useState } from 'react';

// Local datetime <-> ISO helpers. `datetime-local` inputs give/take strings
// like "2026-09-10T18:00" in the browser's local zone, but Postgres stores
// timestamptz. We treat the local wall-clock time as-is when the user picks
// it, converting only at the network boundary.
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

// Build a blank product ready for editing.
function blankProduct(eventId) {
  return {
    id: null,
    event_id: eventId,
    name: '',
    description: '',
    member_only: false,
    max_per_order: 10,
    total_inventory: null,
    sort_order: 0,
    is_active: true,
    tiers: [
      { id: null, name: 'General', price_cents: 2000, starts_at: null, ends_at: null, is_active: true, sort_order: 0 },
    ],
  };
}

// Convert a product coming back from the API into the local edit shape.
function toEditShape(p) {
  return {
    ...p,
    description: p.description || '',
    tiers: (p.tiers || []).map((t) => ({ ...t })),
  };
}

// Given tiers with start/end times, return the tier whose window contains `now`,
// falling back to the first active tier. Mirrors lib/tickets/pricing.js.
function resolveActiveTier(tiers, now = new Date()) {
  const active = tiers.filter((t) => t.is_active !== false);
  const hit = active.find((t) => {
    const s = t.starts_at ? new Date(t.starts_at) : null;
    const e = t.ends_at ? new Date(t.ends_at) : null;
    if (s && now < s) return false;
    if (e && now > e) return false;
    return true;
  });
  return hit || active[0] || null;
}

function TierRow({ tier, onChange, onDelete, canDelete }) {
  return (
    <tr>
      <td>
        <input
          type="text"
          value={tier.name || ''}
          onChange={(e) => onChange({ ...tier, name: e.target.value })}
          placeholder="Early bird"
          style={{ width: '100%' }}
        />
      </td>
      <td>
        <input
          type="number"
          min="0"
          step="0.01"
          value={typeof tier.price_cents === 'number' ? (tier.price_cents / 100).toFixed(2) : ''}
          onChange={(e) => {
            const dollars = parseFloat(e.target.value);
            onChange({ ...tier, price_cents: Number.isFinite(dollars) ? Math.round(dollars * 100) : 0 });
          }}
          style={{ width: 90 }}
        />
      </td>
      <td>
        <input
          type="datetime-local"
          value={isoToLocalInput(tier.starts_at)}
          onChange={(e) => onChange({ ...tier, starts_at: localInputToIso(e.target.value) })}
        />
      </td>
      <td>
        <input
          type="datetime-local"
          value={isoToLocalInput(tier.ends_at)}
          onChange={(e) => onChange({ ...tier, ends_at: localInputToIso(e.target.value) })}
        />
      </td>
      <td>
        <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={tier.is_active !== false}
            onChange={(e) => onChange({ ...tier, is_active: e.target.checked })}
          />
          active
        </label>
      </td>
      <td>
        <button type="button" onClick={onDelete} disabled={!canDelete} title={canDelete ? 'Remove tier' : 'Need at least one tier'}>
          ×
        </button>
      </td>
    </tr>
  );
}

function ProductForm({ eventId, initial, onSave, onCancel, saving }) {
  const [p, setP] = useState(() => (initial ? toEditShape(initial) : blankProduct(eventId)));

  const activeTier = useMemo(() => resolveActiveTier(p.tiers), [p.tiers]);
  const nameValid = p.name.trim().length > 0;
  const tiersValid = p.tiers.length > 0 && p.tiers.every((t) => t.name?.trim() && Number.isFinite(t.price_cents) && t.price_cents >= 0);
  const canSave = nameValid && tiersValid && !saving;

  function updateTier(index, next) {
    setP({ ...p, tiers: p.tiers.map((t, i) => (i === index ? next : t)) });
  }
  function addTier() {
    setP({ ...p, tiers: [...p.tiers, { id: null, name: '', price_cents: 2000, starts_at: null, ends_at: null, is_active: true, sort_order: p.tiers.length }] });
  }
  function removeTier(index) {
    if (p.tiers.length <= 1) return;
    setP({ ...p, tiers: p.tiers.filter((_, i) => i !== index) });
  }

  function submit() {
    // Re-sequence sort_order on save so drag-reorder later is trivial.
    const payload = {
      ...p,
      name: p.name.trim(),
      description: p.description?.trim() || null,
      tiers: p.tiers.map((t, i) => ({ ...t, sort_order: i })),
    };
    onSave(payload);
  }

  return (
    <div style={{ border: '1px solid #ddd', padding: 16, marginBottom: 20, borderRadius: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label>
          <div style={{ fontSize: 12, color: '#666' }}>Name *</div>
          <input type="text" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} style={{ width: '100%' }} placeholder="General Admission" />
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
          <div style={{ fontSize: 12, color: '#666' }}>Total inventory (blank = unlimited)</div>
          <input
            type="number"
            min="0"
            value={p.total_inventory ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              setP({ ...p, total_inventory: v === '' ? null : parseInt(v, 10) });
            }}
            style={{ width: '100%' }}
          />
        </label>
        <label>
          <div style={{ fontSize: 12, color: '#666' }}>Sort order</div>
          <input type="number" value={p.sort_order} onChange={(e) => setP({ ...p, sort_order: parseInt(e.target.value, 10) || 0 })} style={{ width: '100%' }} />
        </label>
        <label>
          <input type="checkbox" checked={!!p.member_only} onChange={(e) => setP({ ...p, member_only: e.target.checked })} /> Members only
        </label>
        <label>
          <input type="checkbox" checked={p.is_active !== false} onChange={(e) => setP({ ...p, is_active: e.target.checked })} /> Product is active
        </label>
      </div>

      <h4 style={{ marginTop: 20, marginBottom: 4 }}>Price tiers</h4>
      <p style={{ margin: '0 0 8px 0', fontSize: 12, color: '#666' }}>
        Each tier is a price window. Leave start/end blank for open-ended. Tiers are checked in order; the first active tier whose window contains "now" wins.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th align="left">Name</th>
            <th align="left">Price ($)</th>
            <th align="left">Starts</th>
            <th align="left">Ends</th>
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {p.tiers.map((t, i) => (
            <TierRow
              key={t.id || `new-${i}`}
              tier={t}
              onChange={(next) => updateTier(i, next)}
              onDelete={() => removeTier(i)}
              canDelete={p.tiers.length > 1}
            />
          ))}
        </tbody>
      </table>
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
            </span>
          ) : (
            <em style={{ color: '#999' }}>no active tier right now</em>
          )}
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button type="button" onClick={submit} disabled={!canSave}>{saving ? 'Saving…' : (p.id ? 'Save changes' : 'Create product')}</button>
        <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
        {!nameValid && <span style={{ color: '#a00', fontSize: 12, alignSelf: 'center' }}>Name required</span>}
        {nameValid && !tiersValid && <span style={{ color: '#a00', fontSize: 12, alignSelf: 'center' }}>Each tier needs a name and a price</span>}
      </div>
    </div>
  );
}

export default function ProductEditor({ eventId, products, onReload }) {
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
            <tr><td colSpan={5} style={{ padding: 12, color: '#666' }}>No products yet. Click "New product" to create one.</td></tr>
          )}
          {products.map((p) => {
            const active = resolveActiveTier(p.tiers || []);
            return (
              <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                <td>
                  <div><strong>{p.name}</strong></div>
                  {p.description && <div style={{ fontSize: 12, color: '#666' }}>{p.description}</div>}
                </td>
                <td>
                  {(p.tiers || []).length} tier(s)
                  {active && <div style={{ fontSize: 12, color: '#083' }}>Now: {money(active.price_cents)} — {active.name}</div>}
                </td>
                <td align="right">
                  {typeof p.total_inventory === 'number' ? p.total_inventory : '∞'}
                  <div style={{ fontSize: 12, color: '#666' }}>{p.sold_count || 0} sold · {p.held_count || 0} held</div>
                </td>
                <td>
                  {p.is_active === false && <span style={{ color: '#a00' }}>inactive </span>}
                  {p.member_only && <span>members only</span>}
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
