'use client';
import { useEffect, useState } from 'react';
import {
  T,
  cardStyle,
  fieldLabelStyle,
  inputStyle,
  pillClass,
  primaryPillStyle,
  ghostPillStyle,
  CheckboxRow,
  tableStyle,
  thStyle,
  tdStyle,
  statusPill,
} from './ticketingTheme.js';

// Admin manager for ticket_discount_codes on one event.
//
// Codes are case-insensitive (stored uppercased). Each code is either a
// percent (0-100) or a fixed dollar amount off the eligible line subtotal.
// Optional: cap max redemptions, start/end window, restrict to specific
// products, deactivate. Themed to match the rest of the admin.

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
    ['percent', 'amount', 'target_total'].includes(c.discount_type) &&
    Number.isFinite(Number(c.discount_value)) &&
    Number(c.discount_value) >= 0 &&
    (c.discount_type !== 'percent' || Number(c.discount_value) <= 100) &&
    (c.applies_to !== 'specific' || (c.product_ids && c.product_ids.length));

  // Per-type UI helpers so the value input is self-explanatory. Cents are the
  // canonical stored unit for amount + target_total; percent stores 0-100.
  const valueLabel =
    c.discount_type === 'percent'
      ? 'Value (0-100)'
      : c.discount_type === 'target_total'
      ? 'Exact price buyer pays (cents)'
      : 'Value (cents)';
  const valueHint =
    c.discount_type === 'target_total'
      ? 'Back-solves booking fee + 8.25% Texas sales tax so the buyer\u2019s final total is exactly this amount.'
      : c.discount_type === 'amount'
      ? 'Flat cents off the subtotal (e.g. 500 = $5.00).'
      : 'Percent off the subtotal.';

  return (
    <div style={{ ...cardStyle({ padding: 20 }), marginBottom: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        <label>
          <div style={fieldLabelStyle()}>Code *</div>
          <input
            type="text"
            value={c.code}
            onChange={(e) => setC({ ...c, code: e.target.value.toUpperCase() })}
            placeholder="EARLYBIRD10"
            style={{ ...inputStyle(), textTransform: 'uppercase', letterSpacing: '0.05em' }}
          />
        </label>
        <label>
          <div style={fieldLabelStyle()}>Type</div>
          <select
            value={c.discount_type}
            onChange={(e) => setC({ ...c, discount_type: e.target.value })}
            style={inputStyle()}
          >
            <option value="percent">Percent off</option>
            <option value="amount">$ off (cents)</option>
            <option value="target_total">Target total ($ after tax + fee)</option>
          </select>
        </label>
        <label>
          <div style={fieldLabelStyle()}>{valueLabel}</div>
          <input
            type="number"
            min="0"
            max={c.discount_type === 'percent' ? 100 : undefined}
            value={c.discount_value ?? ''}
            onChange={(e) => setC({ ...c, discount_value: e.target.value })}
            style={inputStyle()}
          />
          <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>{valueHint}</div>
        </label>
        <label>
          <div style={fieldLabelStyle()}>Applies to</div>
          <select
            value={c.applies_to}
            onChange={(e) => setC({ ...c, applies_to: e.target.value })}
            style={inputStyle()}
          >
            <option value="all_products">All products</option>
            <option value="specific">Specific products</option>
          </select>
        </label>
        <label>
          <div style={fieldLabelStyle()}>Max redemptions (blank = unlimited)</div>
          <input
            type="number"
            min="1"
            value={c.max_redemptions ?? ''}
            onChange={(e) => setC({ ...c, max_redemptions: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
            style={inputStyle()}
          />
        </label>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <CheckboxRow
            checked={c.is_active !== false}
            onChange={(v) => setC({ ...c, is_active: v })}
            label="Active"
          />
        </div>
        <label>
          <div style={fieldLabelStyle()}>Starts (optional)</div>
          <input
            type="datetime-local"
            value={isoToLocal(c.starts_at)}
            onChange={(e) => setC({ ...c, starts_at: localToIso(e.target.value) })}
            style={inputStyle()}
          />
        </label>
        <label>
          <div style={fieldLabelStyle()}>Ends (optional)</div>
          <input
            type="datetime-local"
            value={isoToLocal(c.ends_at)}
            onChange={(e) => setC({ ...c, ends_at: localToIso(e.target.value) })}
            style={inputStyle()}
          />
        </label>
      </div>

      {c.applies_to === 'specific' && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            background: T.innerBg,
            border: `1px solid ${T.borderSoft}`,
            borderRadius: 10,
          }}
        >
          <div style={{ ...fieldLabelStyle(), marginBottom: 8 }}>Apply to these products</div>
          {products.length === 0 && (
            <div style={{ fontSize: 12, color: T.danger }}>
              No products yet — create products above first.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {products.map((p) => (
              <CheckboxRow
                key={p.id}
                checked={c.product_ids?.includes(p.id) || false}
                onChange={(v) => {
                  const set = new Set(c.product_ids || []);
                  if (v) set.add(p.id); else set.delete(p.id);
                  setC({ ...c, product_ids: [...set] });
                }}
                label={p.name}
              />
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 18, display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          type="button"
          onClick={submit}
          disabled={!valid || saving}
          className={pillClass('primary')}
          style={primaryPillStyle({ disabled: !valid || saving })}
        >
          {saving ? 'SAVING…' : (c.id ? 'SAVE' : 'CREATE CODE')}
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
        <CodeForm
          eventId={eventId}
          initial={initial}
          onSave={save}
          onCancel={() => setEditing(null)}
          saving={saving}
          products={products}
        />
      ) : (
        <div style={{ marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className={pillClass('primary')}
            style={primaryPillStyle()}
          >
            + NEW DISCOUNT CODE
          </button>
        </div>
      )}

      {loading && <div style={{ fontSize: 13, color: T.muted, fontFamily: T.fontStack, margin: '8px 0' }}>Loading codes…</div>}

      <table style={tableStyle()}>
        <thead>
          <tr>
            <th style={thStyle()}>Code</th>
            <th style={thStyle()}>Discount</th>
            <th style={thStyle()}>Scope</th>
            <th style={thStyle({ align: 'right' })}>Uses</th>
            <th style={thStyle()}>Window</th>
            <th style={thStyle()}>Status</th>
            <th style={thStyle({ align: 'right' })}></th>
          </tr>
        </thead>
        <tbody>
          {!loading && codes.length === 0 && (
            <tr>
              <td colSpan={7} style={{ ...tdStyle(), color: T.muted, textAlign: 'center' }}>
                No discount codes yet.
              </td>
            </tr>
          )}
          {codes.map((c) => (
            <tr key={c.id}>
              <td style={tdStyle()}>
                <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: T.strongText, letterSpacing: '0.05em' }}>
                  {c.code}
                </code>
              </td>
              <td style={tdStyle()}>
                {c.discount_type === 'percent'
                  ? `${c.discount_value}% off`
                  : c.discount_type === 'target_total'
                  ? `Buyer pays ${money(c.discount_value)}`
                  : `${money(c.discount_value)} off`}
              </td>
              <td style={tdStyle()}>
                {c.applies_to === 'all_products'
                  ? 'All products'
                  : `${(c.product_ids || []).length} product(s)`}
              </td>
              <td style={tdStyle({ align: 'right' })}>
                {c.redemptions_count}
                {c.max_redemptions !== null && c.max_redemptions !== undefined ? ` / ${c.max_redemptions}` : ' / ∞'}
              </td>
              <td style={{ ...tdStyle(), fontSize: 12, color: T.muted }}>
                {c.starts_at ? new Date(c.starts_at).toLocaleString() : '—'}
                {' → '}
                {c.ends_at ? new Date(c.ends_at).toLocaleString() : '—'}
              </td>
              <td style={tdStyle()}>
                {c.is_active
                  ? <span style={statusPill({ tone: 'success' })}>Active</span>
                  : <span style={statusPill({ tone: 'danger' })}>Off</span>}
              </td>
              <td style={tdStyle({ align: 'right' })}>
                <div style={{ display: 'inline-flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setEditing(c.id)}
                    disabled={saving}
                    className={pillClass()}
                    style={ghostPillStyle({ disabled: saving })}
                  >
                    EDIT
                  </button>
                  <button
                    type="button"
                    onClick={() => del(c.id)}
                    disabled={saving}
                    className={pillClass()}
                    style={ghostPillStyle({ disabled: saving, danger: true })}
                  >
                    DELETE
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
