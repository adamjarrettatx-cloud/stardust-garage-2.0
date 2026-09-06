'use client';

// Public purchase widget for events on internal ticketing.
//
// Include from a Server Component like:
//   {event.ticketing_mode === 'internal' && (
//     <InternalTicketPurchase eventId={event.id} isMember={isMember} />
//   )}
//
// The widget:
//   * loads /api/tickets/availability on mount
//   * lets buyer pick per-product quantities (respecting min/max)
//   * for guests, collects email inline
//   * POSTs /api/tickets/hold, redirects to Stripe on success
//
// No secrets touched. Server does all price + inventory enforcement — this
// component only sends { product_id, quantity } plus optional email.

import { useEffect, useState } from 'react';

function formatMoney(cents, currency = 'usd') {
  if (typeof cents !== 'number') return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export default function InternalTicketPurchase({ eventId, isMember = false, buyerEmailPrefill = '' }) {
  const [state, setState] = useState({ loading: true, products: [], error: null });
  const [quantities, setQuantities] = useState({});
  const [email, setEmail] = useState(buyerEmailPrefill);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/tickets/availability?event_id=${encodeURIComponent(eventId)}`);
        if (!res.ok) throw new Error(`Availability lookup failed (${res.status})`);
        const data = await res.json();
        if (cancelled) return;
        const initialQty = {};
        for (const p of data.products || []) {
          initialQty[p.product_id] = 0;
        }
        setQuantities(initialQty);
        setState({ loading: false, products: data.products || [], error: null });
      } catch (err) {
        if (!cancelled) setState({ loading: false, products: [], error: String(err?.message || err) });
      }
    }
    load();
    return () => { cancelled = true; };
  }, [eventId]);

  const totalSelected = Object.values(quantities).reduce((a, b) => a + Number(b || 0), 0);

  const subtotalCents = state.products.reduce((sum, p) => {
    const qty = Number(quantities[p.product_id] || 0);
    if (!qty || !p.price) return sum;
    return sum + qty * p.price.cents;
  }, 0);
  const currency = state.products.find((p) => p.price)?.price?.currency || 'usd';

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
      const res = await fetch('/api/tickets/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          selections,
          ...(isMember ? {} : { buyer_email: email }),
        }),
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

  return (
    <form onSubmit={onCheckout} style={{ padding: 16, border: '1px solid #eee', borderRadius: 8, maxWidth: 480 }}>
      <h3 style={{ margin: '0 0 12px' }}>Tickets</h3>
      {state.products.map((p) => {
        const disabled = !p.on_sale || p.availability === 'sold_out' || (p.member_only && !isMember);
        const max = Math.min(p.max_per_order || 10, p.availability === 'limited' ? 10 : 20);
        const qty = Number(quantities[p.product_id] || 0);
        return (
          <div key={p.product_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f0f0f0', opacity: disabled ? 0.6 : 1 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{p.name}{p.member_only ? ' · Members only' : ''}</div>
              <div style={{ fontSize: 13, color: '#666' }}>
                {p.price ? formatMoney(p.price.cents, p.price.currency) : '—'}
                {p.availability === 'sold_out' && ' · Sold out'}
                {p.availability === 'limited' && ' · Limited'}
                {!p.on_sale && ' · Not on sale'}
              </div>
              {p.description && <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{p.description}</div>}
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

      {!isMember && totalSelected > 0 && (
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

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, fontWeight: 600 }}>
        <span>Subtotal</span>
        <span>{formatMoney(subtotalCents, currency)}</span>
      </div>

      {submitError && <div style={{ color: '#a00', marginTop: 8 }}>{submitError}</div>}

      <button
        type="submit"
        disabled={submitting || totalSelected === 0}
        style={{ marginTop: 12, width: '100%', padding: '12px 16px', background: '#111', color: '#fff', border: 0, borderRadius: 4, cursor: totalSelected ? 'pointer' : 'not-allowed' }}
      >
        {submitting ? 'Starting checkout…' : 'Checkout'}
      </button>

      <div style={{ fontSize: 11, color: '#888', marginTop: 8, textAlign: 'center' }}>
        Secure payment by Stripe. Confirmation email includes your QR ticket.
      </div>
    </form>
  );
}
