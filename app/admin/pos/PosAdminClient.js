'use client';

import { Fragment, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import {
  RESTRICTED_TENDER_POLICIES,
  formatCents,
  TENDER_TYPES,
} from '@/lib/pos-helpers';

const POLICY_LABEL = Object.fromEntries(RESTRICTED_TENDER_POLICIES.map((p) => [p.value, p.label]));
const TENDER_LABEL = Object.fromEntries(TENDER_TYPES.map((t) => [t.value, t.label]));

const POLICY_COLOR = {
  none: '#8a8a8a',
  cash_only: '#4ade80',
  approved_processor_only: '#fbbf24',
};

const TABS = [
  { key: 'products', label: 'Products' },
  { key: 'terminals', label: 'Terminals' },
  { key: 'orders', label: 'Orders' },
  { key: 'sessions', label: 'Cash Sessions' },
];

function field(label, child) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold tracking-[0.08em] mb-1" style={{ color: '#8a8a8a' }}>{label}</span>
      {child}
    </label>
  );
}

const inputStyle = {
  background: '#0f0f0f',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 8,
  padding: '8px 10px',
  width: '100%',
  color: '#fff',
  fontSize: 14,
};

export default function PosAdminClient({ initialProducts, initialTerminals, initialOrders, initialSessions }) {
  const [tab, setTab] = useState('products');
  const [products, setProducts] = useState(initialProducts);
  const [terminals, setTerminals] = useState(initialTerminals);
  const [orders] = useState(initialOrders);
  const [sessions] = useState(initialSessions);
  const [error, setError] = useState(null);

  return (
    <div>
      <div className="flex gap-2 mb-6 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="px-4 py-2.5 text-[14px] font-semibold -mb-px border-b-2 transition-colors"
            style={{
              borderColor: tab === t.key ? '#ffb84d' : 'transparent',
              color: tab === t.key ? '#fff' : '#8a8a8a',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-[10px] px-4 py-3 text-[13px]" style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171' }}>
          {error}
        </div>
      )}

      {tab === 'products' && (
        <ProductsTab products={products} setProducts={setProducts} setError={setError} />
      )}
      {tab === 'terminals' && (
        <TerminalsTab terminals={terminals} setTerminals={setTerminals} setError={setError} />
      )}
      {tab === 'orders' && <OrdersTab orders={orders} />}
      {tab === 'sessions' && <SessionsTab sessions={sessions} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
const EMPTY_PRODUCT = {
  name: '', sku: '', category: '', price_cents: 0, tax_rate_bps: 825,
  taxable: true, active: true, age_restricted: false,
  restricted_tender_policy: 'none', sort_order: 0,
};

function ProductsTab({ products, setProducts, setError }) {
  const [editing, setEditing] = useState(null); // product object or 'new'
  const [form, setForm] = useState(EMPTY_PRODUCT);
  const [saving, setSaving] = useState(false);

  function startNew() { setForm(EMPTY_PRODUCT); setEditing('new'); }
  function startEdit(p) {
    setForm({
      name: p.name || '', sku: p.sku || '', category: p.category || '',
      price_cents: p.price_cents || 0, tax_rate_bps: p.tax_rate_bps || 0,
      taxable: p.taxable, active: p.active, age_restricted: p.age_restricted,
      restricted_tender_policy: p.restricted_tender_policy || 'none',
      sort_order: p.sort_order || 0,
    });
    setEditing(p);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const payload = {
        ...form,
        price_cents: Math.round(Number(form.price_cents) || 0),
        tax_rate_bps: Math.round(Number(form.tax_rate_bps) || 0),
        sort_order: Math.round(Number(form.sort_order) || 0),
      };
      if (editing === 'new') {
        const { product } = await adminFetch('/api/pos/products', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        setProducts((prev) => [...prev, product]);
      } else {
        const { product } = await adminFetch(`/api/pos/products/${editing.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        setProducts((prev) => prev.map((p) => (p.id === product.id ? product : p)));
      }
      setEditing(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(p) {
    if (!confirm(`Deactivate "${p.name}"? It will be hidden from the register.`)) return;
    setError(null);
    try {
      await adminFetch(`/api/pos/products/${p.id}`, { method: 'DELETE' });
      setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, active: false } : x)));
    } catch (err) { setError(err.message); }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <span className="text-[13px]" style={{ color: '#8a8a8a' }}>{products.length} product(s)</span>
        <button onClick={startNew} className="rounded-[8px] px-4 py-2 text-[13px] font-bold" style={{ background: '#ffb84d', color: '#0a0a0a' }}>+ New Product</button>
      </div>

      {editing && (
        <form onSubmit={save} className="rounded-[12px] p-5 mb-6 grid grid-cols-2 gap-4" style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)' }}>
          {field('Name', <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />)}
          {field('SKU', <input style={inputStyle} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />)}
          {field('Category', <input style={inputStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />)}
          {field('Price (cents)', <input type="number" min="0" style={inputStyle} value={form.price_cents} onChange={(e) => setForm({ ...form, price_cents: e.target.value })} />)}
          {field('Tax rate (bps, e.g. 825 = 8.25%)', <input type="number" min="0" max="10000" style={inputStyle} value={form.tax_rate_bps} onChange={(e) => setForm({ ...form, tax_rate_bps: e.target.value })} />)}
          {field('Sort order', <input type="number" style={inputStyle} value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />)}
          {field('Restricted tender policy', (
            <select style={inputStyle} value={form.restricted_tender_policy} onChange={(e) => setForm({ ...form, restricted_tender_policy: e.target.value })}>
              {RESTRICTED_TENDER_POLICIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          ))}
          <div className="flex items-end gap-4 text-[13px]">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.taxable} onChange={(e) => setForm({ ...form, taxable: e.target.checked })} /> Taxable</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.age_restricted} onChange={(e) => setForm({ ...form, age_restricted: e.target.checked })} /> Age 21+</label>
          </div>
          <p className="col-span-2 text-[12px]" style={{ color: '#8a8a8a' }}>
            {RESTRICTED_TENDER_POLICIES.find((p) => p.value === form.restricted_tender_policy)?.help}
          </p>
          <div className="col-span-2 flex gap-3">
            <button type="submit" disabled={saving} className="rounded-[8px] px-5 py-2 text-[13px] font-bold" style={{ background: '#ffb84d', color: '#0a0a0a' }}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-[8px] px-5 py-2 text-[13px]" style={{ color: '#8a8a8a' }}>Cancel</button>
          </div>
        </form>
      )}

      <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ background: '#141414', color: '#8a8a8a' }}>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">SKU</th>
              <th className="text-right px-4 py-3">Price</th>
              <th className="text-left px-4 py-3">Tender policy</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', opacity: p.active ? 1 : 0.5 }}>
                <td className="px-4 py-3 font-semibold">{p.name}{p.age_restricted ? <span title="Age restricted" style={{ color: '#fbbf24' }}> 21+</span> : null}</td>
                <td className="px-4 py-3" style={{ color: '#8a8a8a' }}>{p.sku || '—'}</td>
                <td className="px-4 py-3 text-right">{formatCents(p.price_cents)}</td>
                <td className="px-4 py-3"><span style={{ color: POLICY_COLOR[p.restricted_tender_policy] }}>{POLICY_LABEL[p.restricted_tender_policy]}</span></td>
                <td className="px-4 py-3">{p.active ? 'Active' : 'Inactive'}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => startEdit(p)} className="text-[12px] mr-3" style={{ color: '#60a5fa' }}>Edit</button>
                  {p.active && <button onClick={() => deactivate(p)} className="text-[12px]" style={{ color: '#f87171' }}>Deactivate</button>}
                </td>
              </tr>
            ))}
            {!products.length && <tr><td colSpan={6} className="px-4 py-8 text-center" style={{ color: '#8a8a8a' }}>No products yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------
const EMPTY_TERMINAL = { label: '', terminal_type: 'countertop', location: '', active: true, cash_drawer_attached: false };

function TerminalsTab({ terminals, setTerminals, setError }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_TERMINAL);
  const [saving, setSaving] = useState(false);

  function startNew() { setForm(EMPTY_TERMINAL); setEditing('new'); }
  function startEdit(t) {
    setForm({ label: t.label, terminal_type: t.terminal_type, location: t.location || '', active: t.active, cash_drawer_attached: t.cash_drawer_attached });
    setEditing(t);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      if (editing === 'new') {
        const { terminal } = await adminFetch('/api/pos/terminals', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
        });
        setTerminals((prev) => [...prev, terminal]);
      } else {
        const { terminal } = await adminFetch(`/api/pos/terminals/${editing.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
        });
        setTerminals((prev) => prev.map((t) => (t.id === terminal.id ? terminal : t)));
      }
      setEditing(null);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <span className="text-[13px]" style={{ color: '#8a8a8a' }}>{terminals.length} terminal(s) — target: 2 countertop + 3 handheld</span>
        <button onClick={startNew} className="rounded-[8px] px-4 py-2 text-[13px] font-bold" style={{ background: '#ffb84d', color: '#0a0a0a' }}>+ New Terminal</button>
      </div>

      {editing && (
        <form onSubmit={save} className="rounded-[12px] p-5 mb-6 grid grid-cols-2 gap-4" style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)' }}>
          {field('Label', <input style={inputStyle} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required />)}
          {field('Type', (
            <select style={inputStyle} value={form.terminal_type} onChange={(e) => setForm({ ...form, terminal_type: e.target.value })}>
              <option value="countertop">Countertop</option>
              <option value="handheld">Handheld</option>
            </select>
          ))}
          {field('Location / area', <input style={inputStyle} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />)}
          <div className="flex items-end gap-4 text-[13px]">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.cash_drawer_attached} onChange={(e) => setForm({ ...form, cash_drawer_attached: e.target.checked })} /> Cash drawer attached</label>
          </div>
          <div className="col-span-2 flex gap-3">
            <button type="submit" disabled={saving} className="rounded-[8px] px-5 py-2 text-[13px] font-bold" style={{ background: '#ffb84d', color: '#0a0a0a' }}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-[8px] px-5 py-2 text-[13px]" style={{ color: '#8a8a8a' }}>Cancel</button>
          </div>
          <p className="col-span-2 text-[12px]" style={{ color: '#8a8a8a' }}>Payment processor adapter is selected in Phase 2 — left unset in Phase 1.</p>
        </form>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {terminals.map((t) => (
          <div key={t.id} className="rounded-[12px] p-4" style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)', opacity: t.active ? 1 : 0.5 }}>
            <div className="text-[10px] font-semibold tracking-[0.12em] mb-1" style={{ color: '#8a8a8a' }}>{t.terminal_type.toUpperCase()}</div>
            <div className="text-[16px] font-bold">{t.label}</div>
            <div className="text-[12px] mt-1" style={{ color: '#8a8a8a' }}>{t.location || 'No location set'}</div>
            <div className="text-[12px] mt-2">{t.cash_drawer_attached ? '🗄 Cash drawer' : 'No drawer'} · {t.active ? 'Active' : 'Inactive'}</div>
            <button onClick={() => startEdit(t)} className="text-[12px] mt-3" style={{ color: '#60a5fa' }}>Edit</button>
          </div>
        ))}
        {!terminals.length && <p className="col-span-3 px-4 py-8 text-center text-[13px]" style={{ color: '#8a8a8a' }}>No terminals configured.</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
function OrdersTab({ orders }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
      <table className="w-full text-[13px]">
        <thead>
          <tr style={{ background: '#141414', color: '#8a8a8a' }}>
            <th className="text-left px-4 py-3">Order</th>
            <th className="text-left px-4 py-3">When</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-left px-4 py-3">Tender</th>
            <th className="text-right px-4 py-3">Total</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <Fragment key={o.id}>
              <tr style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <td className="px-4 py-3 font-semibold">{o.order_number || o.id.slice(0, 8)}{o.restricted_items_present ? <span title="Contains restricted items" style={{ color: '#fbbf24' }}> ⚑</span> : null}</td>
                <td className="px-4 py-3" style={{ color: '#8a8a8a' }}>{new Date(o.created_at).toLocaleString('en-US')}</td>
                <td className="px-4 py-3">{o.status}</td>
                <td className="px-4 py-3">{(o.pos_payments || []).map((p) => TENDER_LABEL[p.tender_type] || p.tender_type).join(', ') || '—'}</td>
                <td className="px-4 py-3 text-right">{formatCents(o.total_cents)}</td>
                <td className="px-4 py-3 text-right"><button onClick={() => setOpen(open === o.id ? null : o.id)} className="text-[12px]" style={{ color: '#60a5fa' }}>{open === o.id ? 'Hide' : 'Details'}</button></td>
              </tr>
              {open === o.id && (
                <tr style={{ background: '#0f0f0f' }}>
                  <td colSpan={6} className="px-4 py-3">
                    <div className="text-[12px] font-semibold mb-2" style={{ color: '#8a8a8a' }}>LINE ITEMS</div>
                    {(o.pos_order_items || []).map((it) => (
                      <div key={it.id} className="flex justify-between py-1">
                        <span>{it.quantity}× {it.name_snapshot} {it.restricted_tender_policy !== 'none' ? <span style={{ color: POLICY_COLOR[it.restricted_tender_policy] }}>({POLICY_LABEL[it.restricted_tender_policy]})</span> : null}</span>
                        <span>{formatCents(it.line_total_cents)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-1 mt-2 text-[12px]" style={{ color: '#8a8a8a' }}><span>Subtotal</span><span>{formatCents(o.subtotal_cents)}</span></div>
                    <div className="flex justify-between py-1 text-[12px]" style={{ color: '#8a8a8a' }}><span>Tax</span><span>{formatCents(o.tax_cents)}</span></div>
                    {o.discount_cents > 0 && <div className="flex justify-between py-1 text-[12px]" style={{ color: '#8a8a8a' }}><span>Discount</span><span>−{formatCents(o.discount_cents)}</span></div>}
                    <div className="text-[12px] font-semibold mt-3 mb-1" style={{ color: '#8a8a8a' }}>PAYMENTS</div>
                    {(o.pos_payments || []).map((p) => (
                      <div key={p.id} className="flex justify-between py-1">
                        <span>{TENDER_LABEL[p.tender_type] || p.tender_type} · {p.status}{p.processor_transaction_id ? ` · ref ${p.processor_transaction_id}` : ''}</span>
                        <span>{formatCents(p.amount_cents)}</span>
                      </div>
                    ))}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {!orders.length && <tr><td colSpan={6} className="px-4 py-8 text-center" style={{ color: '#8a8a8a' }}>No orders yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cash Sessions
// ---------------------------------------------------------------------------
function SessionsTab({ sessions }) {
  return (
    <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
      <table className="w-full text-[13px]">
        <thead>
          <tr style={{ background: '#141414', color: '#8a8a8a' }}>
            <th className="text-left px-4 py-3">Terminal</th>
            <th className="text-left px-4 py-3">Opened</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-right px-4 py-3">Opening</th>
            <th className="text-right px-4 py-3">Expected</th>
            <th className="text-right px-4 py-3">Closing</th>
            <th className="text-right px-4 py-3">Variance</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const variance = s.status === 'closed' && s.expected_cash_cents != null && s.closing_cash_cents != null
              ? s.closing_cash_cents - s.expected_cash_cents : null;
            return (
              <tr key={s.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <td className="px-4 py-3 font-semibold">{s.pos_terminals?.label || '—'}</td>
                <td className="px-4 py-3" style={{ color: '#8a8a8a' }}>{new Date(s.opened_at).toLocaleString('en-US')}</td>
                <td className="px-4 py-3">{s.status}</td>
                <td className="px-4 py-3 text-right">{formatCents(s.opening_cash_cents)}</td>
                <td className="px-4 py-3 text-right">{s.expected_cash_cents != null ? formatCents(s.expected_cash_cents) : '—'}</td>
                <td className="px-4 py-3 text-right">{s.closing_cash_cents != null ? formatCents(s.closing_cash_cents) : '—'}</td>
                <td className="px-4 py-3 text-right" style={{ color: variance == null ? '#8a8a8a' : variance === 0 ? '#4ade80' : '#f87171' }}>
                  {variance == null ? '—' : `${variance >= 0 ? '+' : '−'}${formatCents(Math.abs(variance))}`}
                </td>
              </tr>
            );
          })}
          {!sessions.length && <tr><td colSpan={7} className="px-4 py-8 text-center" style={{ color: '#8a8a8a' }}>No cash sessions yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
