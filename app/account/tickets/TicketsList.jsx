'use client';

// TicketsList.jsx
//
// Interactive wallet UI. Receives per-order data (pre-joined by
// lib/wallet/get-orders.js) with each ticket already carrying a rendered QR
// SVG string. Responsibilities live here rather than in the page so that the
// server-side data path stays a straight read:
//
//   * Per-ticket QR expand: tapping a QR icon opens a full-screen dark
//     overlay with a large white QR panel so the door scanner can lock on.
//   * RESEND EMAIL: POSTs to /api/wallet/resend-tickets with the order id;
//     shows a small inline status until the response resolves.
//   * Refund / status pill: coloured based on order.status.
//
// Visual language: matches /tickets/status and the rest of sdgatx.com —
// deep-black hairline cards with a thin gold accent bar at the top,
// Moshra Aesthetic display serif for event titles, receipt-style info rows,
// gold accent (#d9c48c) reserved for links. Every color/spacing is inline
// on purpose so the wallet renders atomically even if Tailwind hasn't
// hydrated (users open this on their phone at the door and cannot afford
// a flash of unstyled content).
//
// Layout is mobile-first: cards stack full-width up to md, then flow into a
// 2-column grid on ≥768px. The card interior does NOT change between sizes
// — only the container. This keeps the QR-tap target predictable.

import { useCallback, useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Design tokens — kept in one place so every card renders as a variant of
// the same system and stays in sync with /tickets/status.
// ---------------------------------------------------------------------------
const CARD_BG = '#141414';
const HAIRLINE = 'rgba(255,255,255,0.08)';
const HAIRLINE_STRONG = 'rgba(255,255,255,0.14)';
const TEXT = '#f5f5f5';
const TEXT_SOFT = '#e0e0e0';
const MUTED = '#8a8a8a';
const MUTED_STRONG = '#c9c9c9';
const GOLD = '#d9c48c';
const SERIF = "'Moshra Aesthetic', 'Cormorant Unicase', 'Cormorant Garamond', serif";
const SANS = "'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif";

// ---------------------------------------------------------------------------
// Formatting helpers — parse date-only fields as LOCAL time so an Oct 8 event
// doesn't show as Oct 7 in West Coast timezones (was previously handled
// inconsistently across the two ticket surfaces).
// ---------------------------------------------------------------------------
function formatOrderDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch { return iso; }
}

function formatEventWhen(event) {
  if (!event?.event_date) return '';
  try {
    const d = new Date(`${event.event_date}T00:00:00`);
    const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' });
    return event.start_time ? `${date} \u00B7 ${event.start_time}` : date;
  } catch {
    return event.event_date;
  }
}

// ---------------------------------------------------------------------------
// Small primitives shared across the wallet — Card shell, InfoRow, pills.
// ---------------------------------------------------------------------------
function statusPill(status) {
  const map = {
    paid: { label: 'PAID', bg: 'rgba(16,185,129,0.14)', color: '#34d399', border: 'rgba(16,185,129,0.3)' },
    refunded: { label: 'REFUNDED', bg: 'rgba(239,68,68,0.14)', color: '#f87171', border: 'rgba(239,68,68,0.3)' },
    partial_refund: { label: 'PARTIAL REFUND', bg: 'rgba(245,158,11,0.14)', color: '#fbbf24', border: 'rgba(245,158,11,0.3)' },
  };
  const s = map[status] || {
    label: (status || '').toUpperCase(),
    bg: 'rgba(255,255,255,0.06)',
    color: '#a0a0a0',
    border: 'rgba(255,255,255,0.14)',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '5px 10px',
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

function InfoRow({ label, value, mono }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 16,
        padding: '12px 0',
        borderTop: `1px solid ${HAIRLINE}`,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: MUTED,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: TEXT,
          textAlign: 'right',
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : SANS,
          wordBreak: mono ? 'break-all' : 'normal',
          lineHeight: 1.4,
        }}
      >
        {value}
      </span>
    </div>
  );
}

// Tiny QR SVG icon (not the real QR — just a visual affordance the user taps).
function QrIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" stroke="currentColor" strokeWidth="1.6"/>
      <rect x="14" y="3" width="7" height="7" stroke="currentColor" strokeWidth="1.6"/>
      <rect x="3" y="14" width="7" height="7" stroke="currentColor" strokeWidth="1.6"/>
      <rect x="14" y="14" width="3" height="3" fill="currentColor"/>
      <rect x="19" y="14" width="2" height="2" fill="currentColor"/>
      <rect x="14" y="19" width="2" height="2" fill="currentColor"/>
      <rect x="18" y="18" width="3" height="3" stroke="currentColor" strokeWidth="1.6"/>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Full-screen QR overlay. White panel on near-black backdrop so the door
// scanner has maximum contrast. Kept close to the existing implementation
// but with slightly tightened typography and a serif "SHOW AT DOOR" label
// swapped for a cleaner uppercase eyebrow.
// ---------------------------------------------------------------------------
function QrOverlay({ ticketCode, qrSvg, eventTitle, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Ticket QR ${ticketCode}`}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        background: 'rgba(0,0,0,0.94)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#ffffff',
          padding: 24,
          borderRadius: 20,
          maxWidth: 400,
          width: '100%',
          position: 'relative',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close QR"
          style={{
            position: 'absolute',
            top: -16,
            right: -16,
            width: 40,
            height: 40,
            borderRadius: 999,
            background: '#0a0a0a',
            color: TEXT,
            border: `1px solid ${HAIRLINE_STRONG}`,
            fontSize: 20,
            lineHeight: 1,
            cursor: 'pointer',
          }}
        >
          {'\u00D7'}
        </button>

        {eventTitle && (
          <div style={{
            textAlign: 'center',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: '#666',
            marginBottom: 14,
          }}>
            {eventTitle}
          </div>
        )}

        <div
          style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />

        <div style={{
          marginTop: 14,
          textAlign: 'center',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 13,
          color: '#0a0a0a',
          letterSpacing: '0.05em',
        }}>
          {ticketCode}
        </div>
        <div style={{
          marginTop: 8,
          textAlign: 'center',
          fontSize: 10,
          color: '#666',
          textTransform: 'uppercase',
          letterSpacing: '0.22em',
          fontWeight: 700,
        }}>
          Show at the door
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Order card — one per ticket order the buyer owns. Layout: hairline card
// with gold accent strip, optional event image, serif event title, receipt
// rows for the details, per-ticket rows with tap-to-expand QR buttons,
// footer with order ref + resend action.
// ---------------------------------------------------------------------------
function OrderCard({ order, venueAddress }) {
  const [expandedTicket, setExpandedTicket] = useState(null);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState('');
  const [qrHover, setQrHover] = useState(null);

  const onResend = useCallback(async () => {
    setResendMsg('');
    setResending(true);
    try {
      const res = await fetch('/api/wallet/resend-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not resend.');
      setResendMsg('Email sent \u2014 check your inbox.');
    } catch (err) {
      setResendMsg(String(err?.message || err));
    } finally {
      setResending(false);
    }
  }, [order.id]);

  const event = order.event || {};
  const eventWhen = formatEventWhen(event);
  const itemById = new Map((order.items || []).map((i) => [i.id, i]));
  const isPaid = order.status === 'paid';

  return (
    <article
      style={{
        position: 'relative',
        background: CARD_BG,
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 20,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* FLYER HERO — the ticket IS the flyer. Full-bleed image at its
          natural aspect, capped so ultra-tall portraits don't dominate the
          page. Event title + status overlay the bottom of the flyer with
          a dark gradient scrim so the type is always legible regardless of
          what the flyer image looks like. If the event has no flyer
          (should be rare), we fall back to a plain gold-accent header. */}
      {event.image_url ? (
        <div style={{ position: 'relative', width: '100%', background: '#0a0a0a' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={event.image_url}
            alt={event.title || ''}
            style={{
              width: '100%',
              maxHeight: 560,
              objectFit: 'contain',
              display: 'block',
              background: '#0a0a0a',
            }}
          />
          {/* Gold hairline strip between flyer and title overlay — echoes
              the /tickets/status accent. */}
          <div
            style={{
              position: 'absolute',
              left: 0, right: 0, bottom: 0,
              paddingTop: 80,
              paddingBottom: 20,
              paddingLeft: 24,
              paddingRight: 24,
              background: 'linear-gradient(180deg, rgba(10,10,10,0) 0%, rgba(10,10,10,0.75) 55%, rgba(10,10,10,0.95) 100%)',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: 14,
            }}
          >
            <h3
              style={{
                fontFamily: SERIF,
                fontSize: 'clamp(30px, 5.5vw, 42px)',
                lineHeight: 1.02,
                letterSpacing: '-0.01em',
                margin: 0,
                color: TEXT,
                fontWeight: 400,
                flex: 1,
                minWidth: 0,
                textShadow: '0 2px 20px rgba(0,0,0,0.6)',
              }}
            >
              {event.title || 'Ticket'}
            </h3>
            <div style={{ flexShrink: 0, marginBottom: 4 }}>{statusPill(order.status)}</div>
          </div>
          {/* Bottom gold hairline — separates flyer from receipt body. */}
          <div
            style={{
              position: 'absolute',
              bottom: 0, left: 0, right: 0,
              height: 2,
              background: `linear-gradient(90deg, transparent 0%, ${GOLD} 50%, transparent 100%)`,
            }}
          />
        </div>
      ) : (
        <div style={{ padding: '28px 24px 0', position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              top: 0, left: 0, right: 0,
              height: 3,
              background: `linear-gradient(90deg, transparent 0%, ${GOLD} 50%, transparent 100%)`,
            }}
          />
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
            <h3
              style={{
                fontFamily: SERIF,
                fontSize: 'clamp(28px, 5vw, 36px)',
                lineHeight: 1.05,
                letterSpacing: '-0.01em',
                margin: 0,
                color: TEXT,
                fontWeight: 400,
                flex: 1,
                minWidth: 0,
              }}
            >
              {event.title || 'Ticket'}
            </h3>
            <div style={{ flexShrink: 0, marginTop: 6 }}>{statusPill(order.status)}</div>
          </div>
        </div>
      )}

      <div style={{ padding: '22px 24px' }}>

        {/* Compact receipt: date, venue, order ref. Uses the same InfoRow
            pattern as /tickets/status so both pages feel like one system. */}
        <div style={{ marginBottom: 22, borderBottom: `1px solid ${HAIRLINE}` }}>
          {eventWhen && <InfoRow label="Date" value={eventWhen} />}
          {venueAddress && <InfoRow label="Venue" value={venueAddress} />}
          <InfoRow label="Order" value={`#${order.id.slice(0, 8).toUpperCase()} \u00B7 ${formatOrderDate(order.created_at)}`} />
        </div>

        {/* Order items list — condensed rollup of what was purchased.
            Rendered separately from per-ticket rows because a single "line
            item" can produce N tickets (quantity > 1). */}
        {order.items?.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.2em',
              color: MUTED, textTransform: 'uppercase', marginBottom: 10,
            }}>
              Order summary
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {order.items.map((item) => (
                <li key={item.id} style={{
                  display: 'flex', justifyContent: 'space-between', gap: 12,
                  padding: '8px 0',
                  fontSize: 13,
                }}>
                  <div style={{ minWidth: 0, color: TEXT_SOFT }}>
                    {item.product_name_snapshot}
                    {item.tier_name_snapshot && (
                      <span style={{ color: MUTED }}>{' \u00B7 '}{item.tier_name_snapshot}</span>
                    )}
                  </div>
                  <div style={{ flexShrink: 0, color: MUTED_STRONG, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                    {'\u00D7'}{item.quantity}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Per-ticket rows — this is the primary action on this page. Each
            row has a large QR button on the left, ticket code + tier on the
            right, and a status pill. The QR button gets a gold outline on
            hover so it reads as the primary tap target. */}
        {order.tickets?.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.2em',
              color: MUTED, textTransform: 'uppercase', marginBottom: 10,
            }}>
              Your tickets
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {order.tickets.map((t) => {
                const it = itemById.get(t.order_item_id);
                const isVoid = t.status === 'void';
                const isHover = qrHover === t.id;
                return (
                  <li key={t.id} style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '12px 0',
                    borderTop: `1px solid ${HAIRLINE}`,
                  }}>
                    <button
                      type="button"
                      onClick={() => !isVoid && setExpandedTicket(t)}
                      onMouseEnter={() => setQrHover(t.id)}
                      onMouseLeave={() => setQrHover(null)}
                      disabled={isVoid}
                      aria-label={`Show QR for ticket ${t.ticket_code}`}
                      style={{
                        flexShrink: 0,
                        width: 48, height: 48, borderRadius: 12,
                        background: isVoid ? '#2a2a2a' : '#ffffff',
                        color: isVoid ? '#555' : '#0a0a0a',
                        border: isHover && !isVoid ? `2px solid ${GOLD}` : '2px solid transparent',
                        cursor: isVoid ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'border-color .15s ease',
                      }}
                    >
                      <QrIcon />
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: 13,
                        color: isVoid ? MUTED : TEXT,
                        letterSpacing: '0.02em',
                      }}>
                        {t.ticket_code}
                      </div>
                      {it && (
                        <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>
                          {it.product_name_snapshot}
                          {it.tier_name_snapshot ? ` \u00B7 ${it.tier_name_snapshot}` : ''}
                        </div>
                      )}
                    </div>
                    <div style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.18em',
                      color: isVoid ? '#f87171' : MUTED,
                    }}>
                      {(t.status || 'active').toUpperCase()}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Footer action — resend email. Muted secondary role; the primary
            action on this card is tapping a QR. */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          gap: 12, paddingTop: 16, borderTop: `1px solid ${HAIRLINE}`,
        }}>
          <button
            type="button"
            onClick={onResend}
            disabled={resending || !isPaid}
            style={{
              padding: '10px 18px', borderRadius: 999,
              background: 'transparent',
              border: `1px solid ${HAIRLINE_STRONG}`,
              color: TEXT,
              fontSize: 11, fontWeight: 700, letterSpacing: '0.16em',
              textTransform: 'uppercase',
              cursor: resending || !isPaid ? 'default' : 'pointer',
              opacity: resending || !isPaid ? 0.4 : 1,
            }}
          >
            {resending ? 'Sending\u2026' : 'Send to email'}
          </button>
        </div>
        {resendMsg && (
          <div style={{ marginTop: 10, fontSize: 12, color: MUTED_STRONG, textAlign: 'right' }}>
            {resendMsg}
          </div>
        )}
      </div>

      {expandedTicket && (
        <QrOverlay
          ticketCode={expandedTicket.ticket_code}
          qrSvg={expandedTicket._qrSvg}
          eventTitle={event.title}
          onClose={() => setExpandedTicket(null)}
        />
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Empty state — no orders on the account. Uses the same branded-card system
// as OrderCard so the wallet always looks like Stardust Garage, never like
// an unstyled dev page. Straight nightclub-brand voice — no cute phrasing.
// ---------------------------------------------------------------------------
function EmptyState() {
  return (
    <div
      style={{
        position: 'relative',
        background: CARD_BG,
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 20,
        padding: '48px 32px 44px',
        overflow: 'hidden',
        textAlign: 'left',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: `linear-gradient(90deg, transparent 0%, ${GOLD} 50%, transparent 100%)`,
        }}
      />
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.22em',
        textTransform: 'uppercase', color: MUTED, marginBottom: 14,
      }}>
        No tickets yet
      </div>
      <h2 style={{
        fontFamily: SERIF,
        fontSize: 'clamp(40px, 7vw, 56px)',
        lineHeight: 1,
        letterSpacing: '-0.02em',
        margin: '0 0 20px',
        color: TEXT,
        fontWeight: 400,
      }}>
        Your wallet is empty.
      </h2>
      <p style={{
        fontSize: 15, lineHeight: 1.6, color: MUTED_STRONG,
        margin: '0 0 28px', maxWidth: '52ch',
      }}>
        Tickets you buy show up on this page. If you bought tickets under a different email or Google account, sign out and back in with that one.
      </p>
      <a
        href="/events"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '15px 28px',
          borderRadius: 999,
          background: TEXT,
          color: '#0a0a0a',
          textDecoration: 'none',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
        }}
      >
        Browse events
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public export — wallet grid.
// ---------------------------------------------------------------------------
export default function TicketsList({ orders, venueAddress }) {
  if (!orders || orders.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="grid gap-4 md:gap-5 md:grid-cols-2">
      {orders.map((o) => (
        <OrderCard key={o.id} order={o} venueAddress={venueAddress} />
      ))}
    </div>
  );
}
