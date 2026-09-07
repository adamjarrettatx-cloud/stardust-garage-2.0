'use client';
import { useEffect, useState } from 'react';

// Admin manager for ticket_discount_codes on one event.
//
// Codes are case-insensitive (stored uppercased). Each code is either a
// percent (0-100) or a fixed dollar amount off the eligible line subtotal.
// Optional: cap max redemptions, start/end window, restrict to specific
// products, deactivate.

function isoToLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localToIso(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function money(cents) {
  if (typeof cents !== 'number') return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'usd' }).format(cents / 100);
}

function blank(eventId) {
  return {
    id: null,
    event_id: eventId,
    code: '',
    discount_type: 'percent',
    discount_value: 10,
    applies_to: 'all_products',
    product_ids: [],
    max_redemptions: null,
    starts_at: null,
    ends_at: null,
    is_active: true,
  };
}

function CodeForm({ eventId, initial, onSave, onCancel, saving, products }) {
  const [c, setC] = useState(() => initial || blank(eventId));

  function submit() {
    const payload = {
      ...c,
      code: c.code.trim().toUpperCase(),
      discount_value: Number(c.discount_value),
      max_redemptions:
        c.max_redemptions === '' || c.max_redemptions === null || c.max_redemptions === undefined
          ? null
          : Number(c.max_redemptions),
      product_ids: c.applies_to === 'specific' ? c.product_ids : null,
    };
    onSave(payload);
  }

  const valid =
    c.code.trim().length >= 2 &&
    ['percent', 'amount'].includes(c.discount_type) &&
    Number.isFinite(Number(c.discount_value)) &&
    Number(c.discount_value) >= 0 &&
    (c.discount_type !== 'percent' || Number(c.discount_value) <= 100) &&
    (c.applies_to !== 'specific' || (c.product_ids && c.product_ids.length));

  return (
    <div style={{ border: '1px solid #ddd', padding: 12, borderRadius: 6, marginBottom: 12, background: '#fafafa' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <label>
          <div style={{ fontSize: 12, color: '#666' }}>Code *</div>
          <input
            type="text"
            value={c.code}
            onChange={(e) => setC({ ...c, code: e.target.value.toUpperCase() })}
            placeholder="EARLYBIRD10"
            style={{ width: '100%', textTransform: 'uppercase' }}
          />
        </label>
        <label>
          <div style={{ fontSize: 12, color: '#666' }}>Type</div>
          <select value={c.discount_type} onChange={(e) => setC({ ...c, discount_type: e.target.value })} style={{ width: '100%' }}>
            <option value="percent">Percent off</option>
            <option value="amount">$ off (cents)</option>
          </select>
        </label>
        <label>
          <div style={{ fontSize: 12, color: '#666' }}>
            Value {c.discount_type === 'percent' ? '(0-100)' : '(cents)'}
          </div>
          <input
            type="number"
            min="0"
            max={c.discount_type === 'percent' ? 100 : undefined}
            value={c.discount_value ?? ''}
            onChange={(e) => setC({ ...c, discount_value: e.target.value })}
            style={{ width: '100%' }}
          />
        </label>
        <label>
          <div style={{ fontSize: 12, color: '#666' }}>Applies to</div>
          <select value={c.applies_to} onChange={(e) => setC({ ...c, applies_to: e.target.value })} style={{ width: '100%' }}>
            <option value="all_products">All products</option>
            <option value="specific">Specific products</option>
          </select>
        </label>
        <label>
          <div style={{ fontSize: 12, color: '#666' }}>Max redemptions (blank = unlimited)</div>
          <input
            type="number"
            min="1"
            value={c.max_redemptions ?? ''}
            onChange={(e) => setC({ ...c, max_redemptions: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
            style={{ width: '100%' }}
          />
        </label>
        <label>
          <input type="checkbox" checked={c.is_active !== false} onChange={(e) => setC({ ...c, is_active: e.target.checked })} /> Active
        </label>
        <label>
          <div style={{ fontSize: 12, color: '#666' }}>Starts (optional)</div>
          <input type="datetime-local" value={isoToLocal(c.starts_at)} onChange={(e) => setC({ ...c, starts_at: localToIso(e.target.value) })} />
        </label>
        <label>
          <div style={{ fontSize: 12, color: '#666' }}>Ends (optional)</div>
          <input type="datetime-local" value={isoToLocal(c.ends_at)} onChange={(e) => setC({ ...c, ends_at: localToIso(e.target.value) })} />
        </label>
      </div>

      {c.applies_to === 'specific' && (
        <div style={{ marginTop: 10, padding: 8, background: '#fff', border: '1px solid #eee', borderRadius: 4 }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Apply to these products:</div>
          {products.length === 0 && <div style={{ fontSize: 12, color: '#a00' }}>No products yet — create products above first.</div>}
          {products.map((p) => (
            <label key={p.id} style={{ display: 'block', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={c.product_ids?.includes(p.id) || false}
                onChange={(e) => {
                  const set = new Set(c.product_ids || []);
                  if (e.target.checked) set.add(p.id); else set.delete(p.id);
                  setC({ ...c, product_ids: [...set] });
                }}
              />{' '}
              {p.name}
            </label>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button type="button" onClick={submit} disabled={!valid || saving}>{saving ? 'Saving…' : (c.id ? 'Save' : 'Create code')}</button>
        <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </div>
  );
}

export default function DiscountCodesManager({ eventId, products = [] }) {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | 'new' | code-id
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/tickets/discount-codes?event_id=${eventId}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Load failed');
      setCodes(data.codes || []);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [eventId]);

  async function save(payload) {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch('/api/admin/tickets/discount-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setEditing(null);
      await load();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function del(id) {
    if (!confirm('Delete this discount code?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/tickets/discount-codes?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      await load();
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  const initial = editing === 'new' ? null : codes.find((c) => c.id === editing) || null;

  return (
    <div>
      {err && <div style={{ color: '#a00', margin: '8px 0' }}>{err}</div>}

      {editing !== null ? (
        <CodeForm
          eventId={eventId}
          initial={initial}
          onSave={save}
          onCancel={() => setEditing(null)}
          saving={saving}
          products={products}
        />
      ) : (
        <button type="button" onClick={() => setEditing('new')} style={{ marginBottom: 12 }}>+ New discount code</button>
      )}

      {loading && <div style={{ fontSize: 13, opacity: 0.7 }}>Loading codes…</div>}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #ccc' }}>
            <th align="left">Code</th>
            <th align="left">Discount</th>
            <th align="left">Scope</th>
            <th align="right">Uses</th>
            <th align="left">Window</th>
            <th align="left">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {!loading && codes.length === 0 && (
            <tr><td colSpan={7} style={{ padding: 12, color: '#666' }}>No discount codes yet.</td></tr>
          )}
          {codes.map((c) => (
            <tr key={c.id} style={{ borderBottom: '1px solid #eee' }}>
              <td><code>{c.code}</code></td>
              <td>
                {c.discount_type === 'percent'
                  ? `${c.discount_value}% off`
                  : `${money(c.discount_value)} off`}
              </td>
              <td>{c.applies_to === 'all_products' ? 'All products' : `${(c.product_ids || []).length} product(s)`}</td>
              <td align="right">
                {c.redemptions_count}
                {c.max_redemptions !== null && c.max_redemptions !== undefined ? ` / ${c.max_redemptions}` : ' / ∞'}
              </td>
              <td style={{ fontSize: 12, color: '#666' }}>
                {c.starts_at ? new Date(c.starts_at).toLocaleString() : '—'}
                {' → '}
                {c.ends_at ? new Date(c.ends_at).toLocaleString() : '—'}
              </td>
              <td>{c.is_active ? <span style={{ color: '#083' }}>Active</span> : <span style={{ color: '#a00' }}>Off</span>}</td>
              <td>
                <button type="button" onClick={() => setEditing(c.id)}>Edit</button>{' '}
                <button type="button" onClick={() => del(c.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
