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
import { useSearchParams } from 'next/navigation';
import { WaiverGate } from '@/components/waiver/WaiverGate';

function formatMoney(cents, currency = 'usd') {
  if (typeof cents !== 'number' || Number.isNaN(cents)) return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

// `preview`: rendered inside the admin-only /events/[slug]/preview route.
// When true, availability requests carry ?preview=1 so drafts render, and
// the checkout CTA is disabled + relabeled so the admin can't accidentally
// try to buy from a draft. (The /api/tickets/hold route is also strict and
// would reject a draft server-side — this is just a UX safety on top.)
// The `isMember` prop is retained for the members-only badge / gating
// logic even though buyer email is no longer read from the widget — the
// InternalTicketModal AccountGate authenticates the buyer before this
// widget mounts, so `/api/tickets/hold` derives buyer email from the
// authenticated identity (see app/api/tickets/hold/route.js). Asking
// for it again in the modal was redundant and confusing.
export default function InternalTicketPurchase({ eventId, isMember = false, preview = false }) {
  const shareToken = useSearchParams().get('t');
  const [state, setState] = useState({ loading: true, event: null, products: [], taxRateBps: 0, error: null });
  const [quantities, setQuantities] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Waiver: fetched from /api/waiver/active on mount; envelope is set by
  // <WaiverGate /> when the buyer ticks the checkbox. Submit is gated on it.
  const [waiverPayload, setWaiverPayload] = useState(null);
  const [waiverState, setWaiverState] = useState(null);

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
    if (preview) qs.set('preview', '1');
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

  // Fetch the current active waiver payload once on mount.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/waiver/active', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setWaiverPayload(data); })
      .catch(() => { /* soft-fail; buy button stays disabled */ });
    return () => { cancelled = true; };
  }, []);

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
      if (!unlockedAny) setAccessCodeError('That code didn’t unlock anything.');
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

    if (!waiverState?.accepted) {
      setSubmitError('Please read and accept the liability waiver to continue.');
      setSubmitting(false);
      return;
    }

    try {
      // Buyer email is no longer sent from the client — the hold route
      // resolves it from the authenticated session (which the AccountGate
      // step in InternalTicketModal guarantees exists by this point).
      const body = {
        event_id: eventId,
        selections,
        waiver: waiverState,
      };
      if (appliedAccessCodes.length) body.access_codes = appliedAccessCodes;
      if (discount?.code) body.discount_code = discount.code;
      if (shareToken) body.share_token = shareToken;

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

  // -------------------------------------------------------------------------
  // Dark-theme skin. This widget lives inside a modal that sits on top of the
  // event page (which is black end-to-end), so everything here uses the same
  // palette: near-black surfaces, hairline white borders, off-white text,
  // gold accent for member-only badges, and the same white pill / rounded
  // 'BUY TICKETS' CTA the rest of the page uses.
  //
  // Every color is inline so the widget renders correctly regardless of
  // whether it's mounted inside a Tailwind tree with the site's CSS vars
  // available. Adam previewed this on production drafts before shipping.
  // -------------------------------------------------------------------------
  // `SURFACE` was the dark card that used to hold the whole product ladder.
  // The ladder now lives inside per-category white cards (see ROW_SURFACE
  // below) so this token is retired — the modal shell itself is the only
  // dark surface now.
  const HAIRLINE = 'rgba(255,255,255,0.10)';
  const HAIRLINE_STRONG = 'rgba(255,255,255,0.18)';
  const TEXT = '#f5f5f5';
  const MUTED = '#8a8a8a';
  const GOLD = '#ffb84d';
  const GREEN = '#5ec27b';
  const DANGER = '#ff6b6b';

  // Light-surface tokens for the product ladder rows. The modal shell stays
  // dark (matches the event page), but the actual ticket rows sit on a white
  // card so the options themselves pop and are easy to read — Adam's ask on
  // the first live pass at the modal. Dark text + hairline separators keep
  // the card feeling premium rather than clinical white.
  const ROW_SURFACE = '#ffffff';
  const ROW_HAIRLINE = 'rgba(0,0,0,0.08)';
  const ROW_HAIRLINE_STRONG = 'rgba(0,0,0,0.14)';
  const ROW_TEXT = '#0a0a0a';
  const ROW_MUTED = '#5a5a5a';
  const ROW_FAINT = '#8a8a8a';

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.04)',
    color: TEXT,
    border: `1px solid ${HAIRLINE_STRONG}`,
    borderRadius: 8,
    fontSize: 13,
    outline: 'none',
  };

  const ghostButtonStyle = {
    padding: '10px 14px',
    background: 'transparent',
    color: TEXT,
    border: `1px solid ${HAIRLINE_STRONG}`,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.06em',
    cursor: 'pointer',
  };

  if (state.loading) {
    return (
      <div style={{ padding: 24, color: MUTED, fontSize: 13, textAlign: 'center' }}>
        Loading tickets…
      </div>
    );
  }
  if (state.error) {
    return (
      <div style={{ padding: 24, color: DANGER, fontSize: 13, textAlign: 'center' }}>
        {state.error}
      </div>
    );
  }
  if (!state.products.length) {
    return (
      <div style={{ padding: 24, color: MUTED, fontSize: 13, textAlign: 'center' }}>
        No tickets available yet.
      </div>
    );
  }

  const anyVisible = state.products.some((p) => p.any_visible !== false);
  if (!anyVisible) {
    return (
      <div style={{ color: TEXT }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Not on sale yet</div>
        <p style={{ fontSize: 13, color: MUTED, margin: '0 0 14px' }}>
          Tickets aren&apos;t available to the public yet. If you have an access code, enter it below.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={accessCodesInput}
            onChange={(e) => setAccessCodesInput(e.target.value)}
            placeholder="Access code"
            style={inputStyle}
          />
          <button type="button" onClick={applyAccessCodes} style={ghostButtonStyle}>
            UNLOCK
          </button>
        </div>
        {accessCodeError && (
          <div style={{ color: DANGER, fontSize: 12, marginTop: 8 }}>{accessCodeError}</div>
        )}
      </div>
    );
  }

  // Split the product list into ticket-kind products and private-space
  // rentals so we can render them under distinct headers instead of one
  // undifferentiated list. Availability preserves display_order inside each
  // group. If a venue ever adds a new `kind`, it falls into the tickets
  // bucket by default rather than disappearing.
  const ticketProducts = state.products.filter((p) => (p.kind || 'tickets') !== 'private_space');
  const spaceProducts = state.products.filter((p) => p.kind === 'private_space');

  // Product-row renderer factored out so the two category groups render
  // identically apart from their contents. `startIdx` is only used for the
  // borderTop rule so the first row in a group has no top divider.
  function renderProductRow(p, indexInGroup) {
    const soldOut = p.availability === 'sold_out' || p.price?.tier_status === 'sold_out';
    const disabled = !p.on_sale || soldOut || (p.member_only && !isMember);
    const max = Math.min(p.max_per_order || 10, p.availability === 'limited' ? 10 : 20);
    const qty = Number(quantities[p.product_id] || 0);
    return (
      <div
        key={p.product_id}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          padding: '16px 18px',
          borderTop: indexInGroup === 0 ? 'none' : `1px solid ${ROW_HAIRLINE}`,
          opacity: disabled ? 0.55 : 1,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: ROW_TEXT }}>{p.name}</span>
            {p.member_only && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                  padding: '3px 8px',
                  borderRadius: 999,
                  background: GOLD,
                  color: '#0a0a0a',
                }}
              >
                MEMBERS ONLY
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: ROW_MUTED, marginTop: 4 }}>
            {p.price ? formatMoney(p.price.cents, p.price.currency) : '—'}
            {p.price?.tier_name ? ` · ${p.price.tier_name}` : ''}
            {soldOut && ' · Sold out'}
            {!soldOut && p.availability === 'limited' && ' · Limited'}
            {!p.on_sale && !soldOut && ' · Not on sale'}
            {p.price?.booking_fee_cents
              ? ` · +${formatMoney(p.price.booking_fee_cents)} fee`
              : ''}
          </div>
          {p.description && (
            <div style={{ fontSize: 12, color: ROW_MUTED, marginTop: 6, opacity: 0.85 }}>
              {p.description}
            </div>
          )}
          {p.tiers && p.tiers.length > 1 && (
            <div style={{ fontSize: 11, color: ROW_FAINT, marginTop: 6 }}>
              Coming next:{' '}
              {p.tiers
                .filter((t) => !t.buyable)
                .slice(0, 2)
                .map((t) => `${t.name} ${formatMoney(t.price_cents, t.currency)}`)
                .join(' · ')}
            </div>
          )}
        </div>
        {/* Quantity stepper. On mobile in-app browsers the native
            number-input spinner is unreliable (invisible on iOS, jumpy
            keyboard on Android), so we render explicit − / + buttons and
            keep the input as a fallback for keyboard entry on desktop.
            The buttons have a 44×44 touch target which is the iOS HIG
            minimum — makes the control easy to hit one-handed. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 0,
            border: `1px solid ${ROW_HAIRLINE_STRONG}`,
            borderRadius: 10,
            background: '#ffffff',
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            aria-label={`Decrease ${p.name} quantity`}
            disabled={disabled || qty <= 0}
            onClick={() => {
              const next = Math.max(0, qty - 1);
              setQuantities({ ...quantities, [p.product_id]: String(next) });
            }}
            style={{
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              borderRight: `1px solid ${ROW_HAIRLINE}`,
              color: qty <= 0 || disabled ? '#c0c0c0' : ROW_TEXT,
              fontSize: 20,
              fontWeight: 600,
              lineHeight: 1,
              cursor: qty <= 0 || disabled ? 'not-allowed' : 'pointer',
              padding: 0,
              WebkitTapHighlightColor: 'transparent',
              userSelect: 'none',
              touchAction: 'manipulation',
            }}
          >
            −
          </button>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={qty}
            disabled={disabled}
            onChange={(e) => {
              // Strip non-digits, clamp to [0, max]. Empty string becomes 0.
              const raw = e.target.value.replace(/[^0-9]/g, '');
              if (raw === '') {
                setQuantities({ ...quantities, [p.product_id]: '0' });
                return;
              }
              const n = Math.min(max, Math.max(0, Number(raw)));
              setQuantities({ ...quantities, [p.product_id]: String(n) });
            }}
            onFocus={(e) => e.target.select()}
            style={{
              width: 40,
              height: 44,
              padding: 0,
              background: 'transparent',
              color: ROW_TEXT,
              border: 'none',
              fontSize: 15,
              fontWeight: 600,
              textAlign: 'center',
              outline: 'none',
              // Hide the native spinners on desktop — our buttons replace them.
              MozAppearance: 'textfield',
            }}
          />
          <button
            type="button"
            aria-label={`Increase ${p.name} quantity`}
            disabled={disabled || qty >= max}
            onClick={() => {
              const next = Math.min(max, qty + 1);
              setQuantities({ ...quantities, [p.product_id]: String(next) });
            }}
            style={{
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              borderLeft: `1px solid ${ROW_HAIRLINE}`,
              color: qty >= max || disabled ? '#c0c0c0' : ROW_TEXT,
              fontSize: 20,
              fontWeight: 600,
              lineHeight: 1,
              cursor: qty >= max || disabled ? 'not-allowed' : 'pointer',
              padding: 0,
              WebkitTapHighlightColor: 'transparent',
              userSelect: 'none',
              touchAction: 'manipulation',
            }}
          >
            +
          </button>
        </div>
      </div>
    );
  }

  // Section wrapper: category label (dark shell text) + the white ticket
  // card underneath. Hidden entirely when a category has zero products so
  // ticket-only events don't get an empty "Private Space Rentals" header.
  function renderProductGroup(title, products) {
    if (!products.length) return null;
    return (
      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: MUTED,
            marginBottom: 8,
            paddingLeft: 2,
          }}
        >
          {title}
        </div>
        <div
          style={{
            background: ROW_SURFACE,
            border: `1px solid ${ROW_HAIRLINE_STRONG}`,
            borderRadius: 14,
            overflow: 'hidden',
            boxShadow: '0 1px 0 rgba(255,255,255,0.03) inset',
          }}
        >
          {products.map((p, i) => renderProductRow(p, i))}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onCheckout} style={{ color: TEXT }}>
      {/* PRODUCT LADDER — split into two categories. Tickets always come
          first; Private Space Rentals only render if the event actually
          has any spaces configured. */}
      {renderProductGroup('Tickets', ticketProducts)}
      {renderProductGroup('Private Space Rentals', spaceProducts)}

      {/* ACCESS + DISCOUNT CODE PAIR — collapsed by default so the widget
          starts clean and doesn't push totals below the fold. */}
      <details style={{ marginTop: 14, fontSize: 13 }}>
        <summary style={{ cursor: 'pointer', color: MUTED, listStyle: 'none' }}>
          Have an access code?
        </summary>
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={accessCodesInput}
            onChange={(e) => setAccessCodesInput(e.target.value)}
            placeholder="Access code"
            style={inputStyle}
          />
          <button type="button" onClick={applyAccessCodes} style={ghostButtonStyle}>
            UNLOCK
          </button>
        </div>
        {appliedAccessCodes.length > 0 && (
          <div style={{ fontSize: 12, color: GREEN, marginTop: 6 }}>
            Applied: {appliedAccessCodes.join(', ')}
          </div>
        )}
        {accessCodeError && (
          <div style={{ color: DANGER, fontSize: 12, marginTop: 6 }}>{accessCodeError}</div>
        )}
      </details>

      <details style={{ marginTop: 8, fontSize: 13 }}>
        <summary style={{ cursor: 'pointer', color: MUTED, listStyle: 'none' }}>
          {discount ? `Discount applied: ${discount.code}` : 'Have a discount code?'}
        </summary>
        {!discount ? (
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value.toUpperCase())}
              placeholder="Discount code"
              style={{ ...inputStyle, textTransform: 'uppercase' }}
            />
            <button
              type="button"
              onClick={applyDiscount}
              disabled={discountBusy}
              style={{ ...ghostButtonStyle, opacity: discountBusy ? 0.6 : 1 }}
            >
              {discountBusy ? 'CHECKING…' : 'APPLY'}
            </button>
          </div>
        ) : (
          <div
            style={{
              marginTop: 8,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              color: TEXT,
            }}
          >
            <span>
              {discount.discount_type === 'percent'
                ? `${discount.discount_value}% off`
                : `${formatMoney(discount.discount_value)} off`}
              {' · '}
              <strong>−{formatMoney(discountCents)}</strong>
            </span>
            <button type="button" onClick={clearDiscount} style={{ ...ghostButtonStyle, padding: '6px 12px', fontSize: 11 }}>
              REMOVE
            </button>
          </div>
        )}
        {discountError && (
          <div style={{ color: DANGER, fontSize: 12, marginTop: 6 }}>{discountError}</div>
        )}
      </details>

      {/* The old "EMAIL FOR TICKETS" field lived here for anonymous buyers.
          The AccountGate in InternalTicketModal now signs the buyer in
          before this widget renders, and /api/tickets/hold pulls the
          buyer's email off the authenticated session, so asking for it a
          second time was redundant. Removed. */}

      {/* TOTALS */}
      <div style={{ marginTop: 20, fontSize: 13, color: TEXT }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
          <span style={{ color: MUTED }}>Subtotal ({totalQty})</span>
          <span>{formatMoney(subtotalCents, currency)}</span>
        </div>
        {discountCents > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: GREEN }}>
            <span>Discount ({discount.code})</span>
            <span>−{formatMoney(discountCents, currency)}</span>
          </div>
        )}
        {bookingFeeCents > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span style={{ color: MUTED }}>Booking fee</span>
            <span>{formatMoney(bookingFeeCents, currency)}</span>
          </div>
        )}
        {taxCents > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span style={{ color: MUTED }}>{`Sales tax (${(taxRateBps / 100).toFixed(2)}%)`}</span>
            <span>{formatMoney(taxCents, currency)}</span>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 10,
            paddingTop: 10,
            borderTop: `1px solid ${HAIRLINE}`,
            fontWeight: 800,
            fontSize: 16,
          }}
        >
          <span>Total</span>
          <span>{formatMoney(totalCents, currency)}</span>
        </div>
      </div>

      {submitError && (
        <div style={{ color: DANGER, fontSize: 13, marginTop: 12 }}>{submitError}</div>
      )}

      {/* Liability waiver — must be accepted on every ticket purchase.
          Renders full text on-page above the CTA; server re-validates
          the version + hash and 409s if the client rendered a stale copy. */}
      {waiverPayload && (
        <div style={{ marginTop: 16 }}>
          <WaiverGate waiver={waiverPayload} onChange={setWaiverState} />
        </div>
      )}

      {/* CTA — same white pill the rest of the event page uses for BUY TICKETS,
          so once you're inside the modal the primary action still reads on-brand. */}
      <button
        type="submit"
        disabled={preview || submitting || totalQty === 0 || !waiverState?.accepted}
        style={{
          marginTop: 16,
          width: '100%',
          padding: '14px 22px',
          background: preview ? 'rgba(255,255,255,0.14)' : totalQty === 0 ? 'rgba(255,255,255,0.14)' : '#ffffff',
          color: preview ? MUTED : totalQty === 0 ? MUTED : '#0a0a0a',
          border: 0,
          borderRadius: 999,
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: '0.08em',
          cursor: preview || totalQty === 0 ? 'not-allowed' : 'pointer',
          transition: 'transform 0.15s ease, background 0.15s ease',
        }}
      >
        {preview
          ? 'CHECKOUT DISABLED IN PREVIEW'
          : submitting
            ? 'STARTING CHECKOUT…'
            : totalQty === 0
              ? 'PICK YOUR TICKETS'
              : !waiverState?.accepted
                ? 'ACCEPT WAIVER TO CONTINUE'
                : `CHECKOUT · ${formatMoney(totalCents, currency)}`}
      </button>

      <div style={{ fontSize: 11, color: MUTED, marginTop: 10, textAlign: 'center', letterSpacing: '0.03em' }}>
        Secure payment by Stripe. Confirmation email includes your QR ticket.
      </div>
    </form>
  );
}
