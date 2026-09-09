'use client';

// WalletClient.jsx
//
// Client half of /member/wallet — saved payment methods + purchase history.
// Server component (page.jsx) renders the hero and MemberIdCard; this
// component adds the two live sections that need client fetches.
//
// Visual language mirrors /account/tickets and /tickets/status:
//   * Deep-black cards (#141414) with hairline borders (rgba(255,255,255,.06))
//   * Uppercase champagne section overlines (letter-spaced, tiny)
//   * Cormorant Garamond serif for section display headings
//   * Plus Jakarta Sans for body / meta / buttons
//   * A single accent color: #d9c48c (champagne)
//   * Coloured pills for order status (paid / refunded / partial_refund)
//
// Every color/spacing is inline on purpose so the wallet renders atomically
// even if Tailwind hasn't hydrated — this is a page members open on their
// phone right at the door and cannot afford a flash of unstyled content.

import { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Design tokens — kept in sync with TicketsList.jsx so the two wallet
// surfaces read as the same product.
// ---------------------------------------------------------------------------
const CARD_BG = '#141414';
const CARD_BG_MUTED = '#101010';
const HAIRLINE = 'rgba(255,255,255,0.06)';
const HAIRLINE_STRONG = 'rgba(255,255,255,0.14)';
const TEXT = '#f5f5f5';
const MUTED = '#8a8a8a';
const MUTED_STRONG = '#c9c9c9';
const GOLD = '#d9c48c';
const DANGER = '#f87171';
const SERIF = "'Cormorant Garamond', 'Cormorant Unicase', 'Moshra Aesthetic', serif";
const SANS = "'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif";

// ---------------------------------------------------------------------------
// Formatting helpers — parse date-only fields as LOCAL time so an Oct 8 event
// doesn't show as Oct 7 in West Coast timezones (parity with TicketsList).
// ---------------------------------------------------------------------------
function money(cents, currency = 'usd') {
  if (typeof cents !== 'number') return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

function formatEventWhen(event) {
  if (!event?.event_date) return '';
  try {
    const d = new Date(`${event.event_date}T00:00:00`);
    const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' });
    return event.event_time ? `${date} \u00B7 ${event.event_time}` : date;
  } catch {
    return event.event_date;
  }
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function SectionOverline({ children }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.24em',
        color: GOLD,
        textTransform: 'uppercase',
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function SectionHeading({ children }) {
  return (
    <h2
      style={{
        margin: 0,
        fontFamily: SERIF,
        fontWeight: 500,
        fontSize: 26,
        letterSpacing: '-0.005em',
        lineHeight: 1.1,
      }}
    >
      {children}
    </h2>
  );
}

function Card({ children, style, ...rest }) {
  return (
    <div
      style={{
        background: CARD_BG,
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 14,
        padding: '18px 20px',
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

function EmptyState({ children }) {
  return (
    <Card
      style={{
        background: CARD_BG_MUTED,
        color: MUTED,
        fontSize: 14,
        textAlign: 'center',
        padding: '22px 20px',
      }}
    >
      {children}
    </Card>
  );
}

function PrimaryButton({ children, ...rest }) {
  return (
    <button
      {...rest}
      style={{
        appearance: 'none',
        background: GOLD,
        color: '#111',
        border: '1px solid transparent',
        borderRadius: 10,
        padding: '11px 18px',
        fontFamily: SANS,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        opacity: rest.disabled ? 0.55 : 1,
        transition: 'opacity 120ms ease, transform 120ms ease',
        ...(rest.style || {}),
      }}
    >
      {children}
    </button>
  );
}

function GhostButton({ children, danger = false, ...rest }) {
  return (
    <button
      {...rest}
      style={{
        appearance: 'none',
        background: 'transparent',
        color: danger ? DANGER : MUTED_STRONG,
        border: `1px solid ${danger ? 'rgba(248,113,113,0.35)' : HAIRLINE_STRONG}`,
        borderRadius: 8,
        padding: '7px 12px',
        fontFamily: SANS,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        opacity: rest.disabled ? 0.55 : 1,
        transition: 'color 120ms ease, border-color 120ms ease',
        ...(rest.style || {}),
      }}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }) {
  const map = {
    paid: { label: 'PAID', bg: 'rgba(217,196,140,0.14)', color: '#d9c48c', border: 'rgba(217,196,140,0.3)' },
    refunded: { label: 'REFUNDED', bg: 'rgba(239,68,68,0.14)', color: '#f87171', border: 'rgba(239,68,68,0.3)' },
    partial_refund: { label: 'PARTIAL REFUND', bg: 'rgba(138,81,9,0.14)', color: '#8a5109', border: 'rgba(245,158,11,0.3)' },
  };
  const s = map[status] || {
    label: (status || '').toUpperCase() || 'PENDING',
    bg: 'rgba(255,255,255,0.06)',
    color: '#a0a0a0',
    border: 'rgba(255,255,255,0.14)',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.16em',
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function WalletClient({ walletEnabled }) {
  const [pms, setPms] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const [pmRes, orderRes] = await Promise.all([
        walletEnabled ? fetch('/api/wallet/payment-methods').then((r) => r.json()) : { payment_methods: [] },
        fetch('/api/wallet/orders').then((r) => r.json()),
      ]);
      setPms(pmRes.payment_methods || []);
      setOrders(orderRes.orders || []);
      setErr(null);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function startSetup() {
    setBusy(true);
    try {
      const res = await fetch('/api/wallet/setup', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Setup failed');
      window.location.href = data.url;
    } catch (e) {
      setErr(String(e?.message || e));
      setBusy(false);
    }
  }

  async function pmAction(pm_id, action) {
    setBusy(true);
    try {
      const res = await fetch('/api/wallet/payment-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_method_id: pm_id, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `${action} failed`);
      await load();
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  }

  async function resend(order_id) {
    setBusy(true);
    try {
      const res = await fetch('/api/wallet/resend-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Resend failed');
      alert('Tickets re-sent to your email.');
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  }

  if (loading) {
    return (
      <div style={{ color: MUTED, fontSize: 14, padding: '24px 0', textAlign: 'center', fontFamily: SANS }}>
        Loading your wallet…
      </div>
    );
  }

  return (
    <div style={{ fontFamily: SANS, color: TEXT }}>
      {err && (
        <div
          role="alert"
          style={{
            margin: '12px 0 20px',
            padding: '12px 14px',
            borderRadius: 10,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.3)',
            color: '#f87171',
            fontSize: 13,
          }}
        >
          {err}
        </div>
      )}

      {walletEnabled && (
        <section style={{ margin: '28px 0 0' }}>
          <SectionOverline>Saved cards</SectionOverline>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
            <SectionHeading>Payment methods</SectionHeading>
          </div>

          {pms.length === 0 ? (
            <EmptyState>No cards on file yet. Add one to check out faster next time.</EmptyState>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {pms.map((pm) => (
                <Card
                  key={pm.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    flexWrap: 'wrap',
                    padding: '14px 18px',
                  }}
                >
                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '0.02em' }}>
                        {pm.brand?.toUpperCase() || 'CARD'} •••• {pm.last4}
                      </span>
                      {pm.is_default && (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: '0.18em',
                            color: GOLD,
                            border: `1px solid ${GOLD}55`,
                            padding: '2px 8px',
                            borderRadius: 999,
                            textTransform: 'uppercase',
                          }}
                        >
                          Default
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: MUTED, letterSpacing: '0.04em' }}>
                      Expires {String(pm.exp_month).padStart(2, '0')}/{pm.exp_year}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    {!pm.is_default && (
                      <GhostButton disabled={busy} onClick={() => pmAction(pm.stripe_payment_method_id, 'default')}>
                        Make default
                      </GhostButton>
                    )}
                    <GhostButton danger disabled={busy} onClick={() => pmAction(pm.stripe_payment_method_id, 'delete')}>
                      Remove
                    </GhostButton>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <PrimaryButton disabled={busy} onClick={startSetup}>Add a card</PrimaryButton>
          </div>
        </section>
      )}

      <section style={{ margin: '40px 0 0' }}>
        <SectionOverline>Purchase history</SectionOverline>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
          <SectionHeading>Your orders</SectionHeading>
        </div>

        {orders.length === 0 ? (
          <EmptyState>No purchases yet. When you buy a ticket, it will show up here and in your email.</EmptyState>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {orders.map((o) => (
              <Card key={o.id} style={{ padding: '18px 20px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 16,
                    marginBottom: 6,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontFamily: SERIF,
                        fontSize: 22,
                        fontWeight: 500,
                        lineHeight: 1.15,
                        letterSpacing: '-0.005em',
                        marginBottom: 4,
                      }}
                    >
                      {o.event?.title || 'Event'}
                    </div>
                    <div style={{ fontSize: 13, color: MUTED, letterSpacing: '0.02em' }}>
                      {formatEventWhen(o.event) || o.event?.event_date}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '0.01em', color: TEXT }}>
                      {money(o.total_cents, o.currency)}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <StatusPill status={o.status} />
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    borderTop: `1px solid ${HAIRLINE}`,
                    paddingTop: 12,
                    marginTop: 12,
                  }}
                >
                  <div style={{ fontSize: 12, color: MUTED_STRONG, letterSpacing: '0.04em' }}>
                    {o.tickets.length} ticket{o.tickets.length === 1 ? '' : 's'}
                  </div>
                  <GhostButton disabled={busy} onClick={() => resend(o.id)}>
                    Resend tickets
                  </GhostButton>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
