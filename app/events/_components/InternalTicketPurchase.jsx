'use client';

// Public purchase widget for events on internal ticketing.
//
// Feature set:
//   * Fetches /api/tickets/availability, which returns per-product current
//     price (with active tier's booking fee), availability, and a projection
//     of any additional visible tiers (revealed by tier_reveal_threshold).
//   * Access-code input: if the buyer has one, resubmit availability with
//     ?codes= so gated tiers unlock inline.
//   * Discount-code input: POSTs to /api/tickets/discount-code/validate for
//     a preview before hitting the hold route. The hold route re-validates
//     server-side.
//   * Quantity picker per product, guest email inline, POSTs /api/tickets/hold
//     with codes + discount and redirects to Stripe on success.
//
// No secrets. Server enforces price + inventory + code rules.

import { useEffect, useMemo, useState } from 'react';

function formatMoney(cents, currency = 'usd') {
  if (typeof cents !== 'number' || Number.isNaN(cents)) return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export default function InternalTicketPurchase({ eventId, isMember = false, buyerEmailPrefill = '' }) {
  const [state, setState] = useState({ loading: true, event: null, products: [], taxRateBps: 0, error: null });
  const [quantities, setQuantities] = useState({});
  const [email, setEmail] = useState(buyerEmailPrefill);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Access codes the buyer has entered (as raw comma-separated text, split
  // client-side on submit).
  const [accessCodesInput, setAccessCodesInput] = useState('');
  const [appliedAccessCodes, setAppliedAccessCodes] = useState([]);
  const [accessCodeError, setAccessCodeError] = useState(null);

  // Discount code state
  const [discountInput, setDiscountInput] = useState('');
  const [discount, setDiscount] = useState(null); // { code, discount_cents, discount_type, discount_value }
  const [discountBusy, setDiscountBusy] = useState(false);
  const [discountError, setDiscountError] = useState(null);

  async function loadAvailability(codes) {
    const qs = new URLSearchParams({ event_id: eventId });
    const list = Array.isArray(codes) ? codes : [];
    if (list.length) qs.set('codes', list.join(','));
    const res = await fetch(`/api/tickets/availability?${qs.toString()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Availability lookup failed (${res.status})`);
    return res.json();
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await loadAvailability([]);
        if (cancelled) return;
        const initialQty = {};
        for (const p of data.products || []) initialQty[p.product_id] = 0;
        setQuantities(initialQty);
        setState({ loading: false, event: data.event || null, products: data.products || [], taxRateBps: Number(data.tax_rate_bps) || 0, error: null });
      } catch (err) {
        if (!cancelled) setState({ loading: false, event: null, products: [], error: String(err?.message || err) });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function applyAccessCodes(e) {
    e?.preventDefault?.();
    setAccessCodeError(null);
    const codes = accessCodesInput
      .split(/[,\s]+/)
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    if (!codes.length) return;
    try {
      const data = await loadAvailability(codes);
      // Detect whether anything new became visible; if not, warn user.
      const nowVisibleTiers = new Set();
      for (const p of data.products || []) {
        for (const t of p.tiers || []) nowVisibleTiers.add(`${p.product_id}:${t.id}`);
      }
      const prevVisibleTiers = new Set();
      for (const p of state.products || []) {
        for (const t of p.tiers || []) prevVisibleTiers.add(`${p.product_id}:${t.id}`);
      }
      let unlockedAny = false;
      for (const key of nowVisibleTiers) if (!prevVisibleTiers.has(key)) { unlockedAny = true; break; }

      setAppliedAccessCodes(codes);
      setState((s) => ({ ...s, event: data.event || s.event, products: data.products || [], taxRateBps: Number(data.tax_rate_bps) || s.taxRateBps || 0 }));
      // Preserve quantities for known products; init new ones.
      setQuantities((prev) => {
        const next = { ...prev };
        for (const p of data.products || []) if (!(p.product_id in next)) next[p.product_id] = 0;
        return next;
      });
      if (!unlockedAny) setAccessCodeError('That code didn\u2019t unlock anything.');
    } catch (err) {
      setAccessCodeError(String(err?.message || err));
    }
  }

  const currency = state.products.find((p) => p.price)?.price?.currency || 'usd';

  // Build selection line items for the validate call. Each product's active
  // tier price + fee is what will be charged.
  const lineItems = useMemo(() => {
    const items = [];
    for (const p of state.products) {
      const qty = Number(quantities[p.product_id] || 0);
      if (!qty || !p.price) continue;
      items.push({ product_id: p.product_id, unit_price_cents: p.price.cents, quantity: qty });
    }
    return items;
  }, [state.products, quantities]);

  const subtotalCents = lineItems.reduce((sum, it) => sum + it.unit_price_cents * it.quantity, 0);
  const totalQty = lineItems.reduce((sum, it) => sum + it.quantity, 0);

  const bookingFeeCents = state.products.reduce((sum, p) => {
    const qty = Number(quantities[p.product_id] || 0);
    if (!qty || !p.price) return sum;
    return sum + qty * (p.price.booking_fee_cents || 0);
  }, 0);

  const discountCents = discount?.discount_cents || 0;
  const preTaxCents = Math.max(0, subtotalCents - discountCents) + bookingFeeCents;
  // Texas sales tax (8.25%) is the platform-wide rate; server is the source
  // of truth via availability.tax_rate_bps.
  const taxRateBps = Number(state.taxRateBps) || 0;
  const taxCents = Math.round(preTaxCents * (taxRateBps / 10000));
  const totalCents = preTaxCents + taxCents;

  async function applyDiscount(e) {
    e?.preventDefault?.();
    setDiscountError(null);
    if (!discountInput.trim()) return;
    if (!lineItems.length) {
      setDiscountError('Pick tickets before applying a discount code.');
      return;
    }
    setDiscountBusy(true);
    try {
      // Passing booking_fee_cents lets the server back-solve target_total
      // codes correctly (percent/amount codes ignore it).
      const res = await fetch('/api/tickets/discount-code/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          code: discountInput.trim(),
          items: lineItems,
          booking_fee_cents: bookingFeeCents,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Discount code failed');
      setDiscount(data);
    } catch (err) {
      setDiscount(null);
      setDiscountError(String(err?.message || err));
    } finally {
      setDiscountBusy(false);
    }
  }
  function clearDiscount() {
    setDiscount(null);
    setDiscountInput('');
    setDiscountError(null);
  }

  async function onCheckout(e) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);

    const selections = Object.entries(quantities)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([product_id, qty]) => ({ product_id, quantity: Number(qty) }));

    if (!selections.length) {
      setSubmitError('Pick at least one ticket.');
      setSubmitting(false);
      return;
    }

    try {
      const body = {
        event_id: eventId,
        selections,
        ...(isMember ? {} : { buyer_email: email }),
      };
      if (appliedAccessCodes.length) body.access_codes = appliedAccessCodes;
      if (discount?.code) body.discount_code = discount.code;

      const res = await fetch('/api/tickets/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.checkout_url) {
        throw new Error(data.error || 'Checkout failed');
      }
      window.location.href = data.checkout_url;
    } catch (err) {
      setSubmitError(String(err?.message || err));
      setSubmitting(false);
    }
  }

  if (state.loading) return <div style={{ padding: 16 }}>Loading tickets…</div>;
  if (state.error) return <div style={{ padding: 16, color: '#a00' }}>{state.error}</div>;
  if (!state.products.length) return <div style={{ padding: 16 }}>No tickets available yet.</div>;

  const anyVisible = state.products.some((p) => p.any_visible !== false);
  if (!anyVisible) {
    return (
      <div style={{ padding: 16, border: '1px solid #eee', borderRadius: 8, maxWidth: 480 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Not on sale yet</div>
        <p style={{ fontSize: 13, color: '#666', margin: 0 }}>
          Tickets aren&apos;t available to the public yet. If you have an access code, enter it below.
        </p>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={accessCodesInput}
            onChange={(e) => setAccessCodesInput(e.target.value)}
            placeholder="Access code"
            style={{ flex: 1, padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
          />
          <button type="button" onClick={applyAccessCodes} style={{ padding: '8px 16px' }}>Unlock</button>
        </div>
        {accessCodeError && <div style={{ color: '#a00', fontSize: 12, marginTop: 6 }}>{accessCodeError}</div>}
      </div>
    );
  }

  return (
    <form onSubmit={onCheckout} style={{ padding: 16, border: '1px solid #eee', borderRadius: 8, maxWidth: 480 }}>
      <h3 style={{ margin: '0 0 12px' }}>Tickets</h3>

      {state.products.map((p) => {
        const soldOut = p.availability === 'sold_out' || p.price?.tier_status === 'sold_out';
        const disabled = !p.on_sale || soldOut || (p.member_only && !isMember);
        const max = Math.min(p.max_per_order || 10, p.availability === 'limited' ? 10 : 20);
        const qty = Number(quantities[p.product_id] || 0);
        return (
          <div key={p.product_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f0f0f0', opacity: disabled ? 0.6 : 1 }}>
            <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
              <div style={{ fontWeight: 600 }}>{p.name}{p.member_only ? ' · Members only' : ''}</div>
              <div style={{ fontSize: 13, color: '#666' }}>
                {p.price ? formatMoney(p.price.cents, p.price.currency) : '—'}
                {p.price?.tier_name ? ` · ${p.price.tier_name}` : ''}
                {soldOut && ' · Sold out'}
                {!soldOut && p.availability === 'limited' && ' · Limited'}
                {!p.on_sale && !soldOut && ' · Not on sale'}
                {p.price?.booking_fee_cents ? ` · +${formatMoney(p.price.booking_fee_cents)} fee` : ''}
              </div>
              {p.description && <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{p.description}</div>}
              {p.tiers && p.tiers.length > 1 && (
                <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                  Coming next:{' '}
                  {p.tiers
                    .filter((t) => !t.buyable)
                    .slice(0, 2)
                    .map((t) => `${t.name} ${formatMoney(t.price_cents, t.currency)}`)
                    .join(' · ')}
                </div>
              )}
            </div>
            <input
              type="number"
              min={0}
              max={max}
              value={qty}
              disabled={disabled}
              onChange={(e) => setQuantities({ ...quantities, [p.product_id]: e.target.value })}
              style={{ width: 64, padding: 6 }}
            />
          </div>
        );
      })}

      <details style={{ marginTop: 12, fontSize: 13 }}>
        <summary style={{ cursor: 'pointer', color: '#555' }}>Have an access code?</summary>
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={accessCodesInput}
            onChange={(e) => setAccessCodesInput(e.target.value)}
            placeholder="Access code"
            style={{ flex: 1, padding: 6, border: '1px solid #ccc', borderRadius: 4 }}
          />
          <button type="button" onClick={applyAccessCodes} style={{ padding: '6px 12px' }}>Unlock</button>
        </div>
        {appliedAccessCodes.length > 0 && (
          <div style={{ fontSize: 12, color: '#083', marginTop: 4 }}>
            Applied: {appliedAccessCodes.join(', ')}
          </div>
        )}
        {accessCodeError && <div style={{ color: '#a00', fontSize: 12, marginTop: 4 }}>{accessCodeError}</div>}
      </details>

      <details style={{ marginTop: 8, fontSize: 13 }}>
        <summary style={{ cursor: 'pointer', color: '#555' }}>
          {discount ? `Discount applied: ${discount.code}` : 'Have a discount code?'}
        </summary>
        {!discount ? (
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value.toUpperCase())}
              placeholder="Discount code"
              style={{ flex: 1, padding: 6, border: '1px solid #ccc', borderRadius: 4, textTransform: 'uppercase' }}
            />
            <button type="button" onClick={applyDiscount} disabled={discountBusy} style={{ padding: '6px 12px' }}>
              {discountBusy ? 'Checking…' : 'Apply'}
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              {discount.discount_type === 'percent'
                ? `${discount.discount_value}% off`
                : `${formatMoney(discount.discount_value)} off`}
              {' · '}<strong>−{formatMoney(discountCents)}</strong>
            </span>
            <button type="button" onClick={clearDiscount} style={{ padding: '4px 8px', fontSize: 12 }}>Remove</button>
          </div>
        )}
        {discountError && <div style={{ color: '#a00', fontSize: 12, marginTop: 4 }}>{discountError}</div>}
      </details>

      {!isMember && totalQty > 0 && (
        <div style={{ marginTop: 12 }}>
          <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Email for tickets</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
          />
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 13 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Subtotal ({totalQty})</span>
          <span>{formatMoney(subtotalCents, currency)}</span>
        </div>
        {discountCents > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#083' }}>
            <span>Discount ({discount.code})</span>
            <span>−{formatMoney(discountCents, currency)}</span>
          </div>
        )}
        {bookingFeeCents > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666' }}>
            <span>Booking fee</span>
            <span>{formatMoney(bookingFeeCents, currency)}</span>
          </div>
        )}
        {taxCents > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666' }}>
            <span>{`Sales tax (${(taxRateBps / 100).toFixed(2)}%)`}</span>
            <span>{formatMoney(taxCents, currency)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontWeight: 700, fontSize: 15 }}>
          <span>Total</span>
          <span>{formatMoney(totalCents, currency)}</span>
        </div>
      </div>

      {submitError && <div style={{ color: '#a00', marginTop: 8 }}>{submitError}</div>}

      <button
        type="submit"
        disabled={submitting || totalQty === 0}
        style={{ marginTop: 12, width: '100%', padding: '12px 16px', background: '#111', color: '#fff', border: 0, borderRadius: 4, cursor: totalQty ? 'pointer' : 'not-allowed' }}
      >
        {submitting ? 'Starting checkout…' : `Checkout · ${formatMoney(totalCents, currency)}`}
      </button>

      <div style={{ fontSize: 11, color: '#888', marginTop: 8, textAlign: 'center' }}>
        Secure payment by Stripe. Confirmation email includes your QR ticket.
      </div>
    </form>
  );
}
