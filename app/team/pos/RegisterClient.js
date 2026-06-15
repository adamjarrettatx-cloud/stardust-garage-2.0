'use client';

import { useMemo, useState } from 'react';
import {
  calcCart,
  allowedTendersForCart,
  validateTenderForCart,
  formatCents,
  RESTRICTED_TENDER_POLICIES,
} from '@/lib/pos-helpers';

const POLICY_LABEL = Object.fromEntries(RESTRICTED_TENDER_POLICIES.map((p) => [p.value, p.label]));
const POLICY_COLOR = { none: '#8a8a8a', cash_only: '#4ade80', approved_processor_only: '#fbbf24' };

export default function RegisterClient({ products, terminals, cashierName }) {
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]); // [{ product, quantity }]
  const [terminalId, setTerminalId] = useState(terminals[0]?.id || '');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q)
    );
  }, [products, search]);

  // Cart items shaped for the calc/validation helpers.
  const cartItems = useMemo(() => cart.map(({ product, quantity }) => ({
    product_id: product.id,
    name: product.name,
    sku: product.sku,
    price_cents: product.price_cents,
    quantity,
    taxable: product.taxable,
    tax_rate_bps: product.tax_rate_bps,
    restricted_tender_policy: product.restricted_tender_policy,
  })), [cart]);

  const totals = useMemo(() => calcCart(cartItems), [cartItems]);
  const tenders = useMemo(() => allowedTendersForCart(cartItems), [cartItems]);

  function addToCart(product) {
    setMessage(null);
    setCart((prev) => {
      const existing = prev.find((c) => c.product.id === product.id);
      if (existing) return prev.map((c) => (c.product.id === product.id ? { ...c, quantity: c.quantity + 1 } : c));
      return [...prev, { product, quantity: 1 }];
    });
  }
  function setQty(productId, quantity) {
    setCart((prev) => prev
      .map((c) => (c.product.id === productId ? { ...c, quantity: Math.max(0, quantity) } : c))
      .filter((c) => c.quantity > 0));
  }
  function clearCart() { setCart([]); setReference(''); }

  async function checkout(tenderType) {
    setError(null); setMessage(null);
    // Client-side guard (server re-validates).
    const check = validateTenderForCart(cartItems, tenderType);
    if (!check.allowed) { setError(check.reason); return; }

    setBusy(true);
    try {
      const res = await fetch('/api/pos/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          terminal_id: terminalId || null,
          items: cartItems,
          tender: { type: tenderType, reference: tenderType === 'manual_external' ? reference : null },
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Checkout failed.'); return; }
      setMessage(`Order ${json.order_number} completed — ${formatCents(json.order.total_cents)}.`);
      clearCart();
    } catch (err) {
      setError(err.message || 'Checkout failed.');
    } finally {
      setBusy(false);
    }
  }

  const hasCashOnly = cartItems.some((i) => i.restricted_tender_policy === 'cash_only');
  const hasApprovedOnly = cartItems.some((i) => i.restricted_tender_policy === 'approved_processor_only');

  return (
    <main className="max-w-[1280px] mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[28px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Register</h1>
          <p className="text-[13px]" style={{ color: '#8a8a8a' }}>Cashier: {cashierName} · Phase 1 (no live card processing)</p>
        </div>
        <select value={terminalId} onChange={(e) => setTerminalId(e.target.value)} className="rounded-[8px] px-3 py-2 text-[13px]" style={{ background: '#0f0f0f', border: '1px solid rgba(255,255,255,0.10)', color: '#fff' }}>
          <option value="">No terminal</option>
          {terminals.map((t) => <option key={t.id} value={t.id}>{t.label} ({t.terminal_type})</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        {/* Product grid */}
        <div>
          <input
            placeholder="Search products by name, SKU, barcode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-[10px] px-4 py-3 mb-4 text-[14px]"
            style={{ background: '#0f0f0f', border: '1px solid rgba(255,255,255,0.10)', color: '#fff' }}
          />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                className="text-left rounded-[12px] p-4 transition-colors hover:border-white/20"
                style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <div className="text-[14px] font-bold">{p.name}</div>
                <div className="text-[13px] mt-1">{formatCents(p.price_cents)}</div>
                {p.restricted_tender_policy !== 'none' && (
                  <div className="text-[11px] mt-2" style={{ color: POLICY_COLOR[p.restricted_tender_policy] }}>
                    {POLICY_LABEL[p.restricted_tender_policy]}
                  </div>
                )}
                {p.age_restricted && <div className="text-[11px] mt-1" style={{ color: '#fbbf24' }}>21+</div>}
              </button>
            ))}
            {!filtered.length && <p className="col-span-3 py-10 text-center text-[13px]" style={{ color: '#8a8a8a' }}>No matching products.</p>}
          </div>
        </div>

        {/* Cart */}
        <div className="rounded-[14px] p-5 self-start" style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="text-[12px] font-semibold tracking-[0.12em] mb-3" style={{ color: '#8a8a8a' }}>CART</div>

          {!cart.length && <p className="text-[13px] py-6 text-center" style={{ color: '#8a8a8a' }}>Tap a product to add it.</p>}

          {cart.map(({ product, quantity }) => (
            <div key={product.id} className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="flex-1">
                <div className="text-[13px] font-semibold">{product.name}</div>
                <div className="text-[12px]" style={{ color: '#8a8a8a' }}>{formatCents(product.price_cents)} ea</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setQty(product.id, quantity - 1)} className="w-7 h-7 rounded-[6px]" style={{ background: '#0f0f0f', border: '1px solid rgba(255,255,255,0.10)' }}>−</button>
                <span className="w-6 text-center text-[13px]">{quantity}</span>
                <button onClick={() => setQty(product.id, quantity + 1)} className="w-7 h-7 rounded-[6px]" style={{ background: '#0f0f0f', border: '1px solid rgba(255,255,255,0.10)' }}>+</button>
              </div>
            </div>
          ))}

          {cart.length > 0 && (
            <>
              <div className="mt-4 space-y-1 text-[13px]">
                <div className="flex justify-between" style={{ color: '#8a8a8a' }}><span>Subtotal</span><span>{formatCents(totals.subtotal_cents)}</span></div>
                <div className="flex justify-between" style={{ color: '#8a8a8a' }}><span>Tax</span><span>{formatCents(totals.tax_cents)}</span></div>
                <div className="flex justify-between text-[18px] font-bold mt-2"><span>Total</span><span>{formatCents(totals.total_cents)}</span></div>
              </div>

              {(hasCashOnly || hasApprovedOnly) && (
                <div className="mt-4 rounded-[10px] px-3 py-2.5 text-[12px]" style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}>
                  {hasCashOnly && <div>Cart contains a cash-only item — card/external tenders are disabled.</div>}
                  {hasApprovedOnly && <div>Cart contains an approved-processor-only item — mainstream card/ACH is blocked.</div>}
                </div>
              )}

              {tenders.some((t) => t.value === 'manual_external' && t.enabled) && (
                <input
                  placeholder="External card ref / last 4 (optional)"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full rounded-[8px] px-3 py-2 mt-4 text-[13px]"
                  style={{ background: '#0f0f0f', border: '1px solid rgba(255,255,255,0.10)', color: '#fff' }}
                />
              )}

              <div className="grid grid-cols-2 gap-2 mt-4">
                {tenders.map((t) => (
                  <button
                    key={t.value}
                    disabled={!t.enabled || busy}
                    onClick={() => checkout(t.value)}
                    className="rounded-[10px] px-3 py-3 text-[13px] font-bold transition-opacity"
                    title={!t.enabled ? 'Disabled by restricted-tender policy' : undefined}
                    style={{
                      background: t.enabled ? '#ffb84d' : '#2a2a2a',
                      color: t.enabled ? '#0a0a0a' : '#666',
                      cursor: t.enabled && !busy ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <button onClick={clearCart} className="w-full mt-3 text-[12px]" style={{ color: '#8a8a8a' }}>Clear cart</button>
            </>
          )}

          {message && <div className="mt-4 rounded-[10px] px-3 py-2.5 text-[13px]" style={{ background: 'rgba(74,222,128,0.12)', color: '#4ade80' }}>{message}</div>}
          {error && <div className="mt-4 rounded-[10px] px-3 py-2.5 text-[13px]" style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171' }}>{error}</div>}
        </div>
      </div>
    </main>
  );
}
