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
// Layout is mobile-first: cards stack full-width up to md, then flow into a
// 2-column grid on \u2265768px. The card interior does NOT change between sizes
// \u2014 only the container. This keeps the QR-tap target predictable.

import { useCallback, useEffect, useState } from 'react';

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

function statusPill(status) {
  const map = {
    paid: { label: 'PAID', bg: 'rgba(16,185,129,0.12)', color: '#10b981' },
    refunded: { label: 'REFUNDED', bg: 'rgba(239,68,68,0.12)', color: '#ef4444' },
    partial_refund: { label: 'PARTIAL REFUND', bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' },
  };
  const s = map[status] || { label: (status || '').toUpperCase(), bg: 'rgba(255,255,255,0.06)', color: '#a0a0a0' };
  return (
    <span
      className="inline-block px-2.5 py-1 rounded-full text-[10px] font-bold tracking-[0.12em]"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

// Tiny QR SVG icon (not the real QR \u2014 just a visual affordance the user taps).
function QrIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

function QrOverlay({ ticketCode, qrSvg, onClose }) {
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
        background: 'rgba(0,0,0,0.92)',
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
          padding: 20,
          borderRadius: 16,
          maxWidth: 380,
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
            top: -14,
            right: -14,
            width: 36,
            height: 36,
            borderRadius: 999,
            background: '#0a0a0a',
            color: '#f5f5f5',
            border: '1px solid rgba(255,255,255,0.2)',
            fontSize: 18,
            lineHeight: 1,
            cursor: 'pointer',
          }}
        >
          \u00D7
        </button>
        <div
          style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
        <div style={{
          marginTop: 12, textAlign: 'center', fontFamily: 'monospace',
          fontSize: 14, color: '#0a0a0a', letterSpacing: '0.05em',
        }}>
          {ticketCode}
        </div>
        <div style={{
          marginTop: 8, textAlign: 'center', fontSize: 11, color: '#666',
          textTransform: 'uppercase', letterSpacing: '0.14em',
        }}>
          Show at the door
        </div>
      </div>
    </div>
  );
}

function OrderCard({ order, venueAddress }) {
  const [expandedTicket, setExpandedTicket] = useState(null);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState('');

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

  return (
    <article
      style={{
        background: '#111',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {event.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={event.image_url}
          alt={event.title || ''}
          style={{
            width: '100%',
            height: 180,
            objectFit: 'cover',
            display: 'block',
            background: '#0a0a0a',
          }}
        />
      )}

      <div style={{ padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{
              fontSize: 18, fontWeight: 800, letterSpacing: '-0.01em',
              margin: 0, color: '#f5f5f5',
              fontFamily: "'Plus Jakarta Sans', sans-serif",
            }}>
              {event.title || 'Stardust Garage'}
            </h3>
            {eventWhen && (
              <div style={{ marginTop: 4, fontSize: 13, color: '#a0a0a0' }}>{eventWhen}</div>
            )}
            {venueAddress && (
              <div style={{ marginTop: 2, fontSize: 12, color: '#8a8a8a' }}>{venueAddress}</div>
            )}
          </div>
          <div style={{ flexShrink: 0 }}>{statusPill(order.status)}</div>
        </div>

        {/* Order items list */}
        {order.items?.length > 0 && (
          <ul style={{
            listStyle: 'none', padding: 0, margin: '14px 0 0',
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}>
            {order.items.map((item) => (
              <li key={item.id} style={{
                display: 'flex', justifyContent: 'space-between', gap: 12,
                padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
                fontSize: 13,
              }}>
                <div style={{ minWidth: 0, color: '#e0e0e0' }}>
                  {item.product_name_snapshot}
                  {item.tier_name_snapshot && (
                    <span style={{ color: '#8a8a8a' }}> \u00B7 {item.tier_name_snapshot}</span>
                  )}
                </div>
                <div style={{ flexShrink: 0, color: '#a0a0a0', fontFamily: 'monospace' }}>
                  \u00D7{item.quantity}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Per-ticket rows */}
        {order.tickets?.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
              color: '#8a8a8a', textTransform: 'uppercase', marginBottom: 8,
            }}>
              Your tickets
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {order.tickets.map((t) => {
                const it = itemById.get(t.order_item_id);
                return (
                  <li key={t.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
                  }}>
                    <button
                      type="button"
                      onClick={() => setExpandedTicket(t)}
                      aria-label={`Show QR for ticket ${t.ticket_code}`}
                      style={{
                        flexShrink: 0,
                        width: 44, height: 44, borderRadius: 10,
                        background: '#ffffff', color: '#0a0a0a',
                        border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <QrIcon />
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#f5f5f5' }}>
                        {t.ticket_code}
                      </div>
                      {it && (
                        <div style={{ fontSize: 11, color: '#8a8a8a', marginTop: 2 }}>
                          {it.product_name_snapshot}
                          {it.tier_name_snapshot ? ` \u00B7 ${it.tier_name_snapshot}` : ''}
                        </div>
                      )}
                    </div>
                    <div style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
                      color: t.status === 'void' ? '#ef4444' : '#8a8a8a',
                    }}>
                      {(t.status || 'active').toUpperCase()}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div style={{
          marginTop: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 11, color: '#666' }}>
            Order {order.id.slice(0, 8)} \u00B7 {formatOrderDate(order.created_at)}
          </div>
          <button
            type="button"
            onClick={onResend}
            disabled={resending || order.status !== 'paid'}
            className="disabled:opacity-40"
            style={{
              padding: '8px 14px', borderRadius: 999,
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#f5f5f5',
              fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
              cursor: 'pointer',
            }}
          >
            {resending ? 'SENDING\u2026' : 'RESEND EMAIL'}
          </button>
        </div>
        {resendMsg && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#a0a0a0' }}>{resendMsg}</div>
        )}
      </div>

      {expandedTicket && (
        <QrOverlay
          ticketCode={expandedTicket.ticket_code}
          qrSvg={expandedTicket._qrSvg}
          onClose={() => setExpandedTicket(null)}
        />
      )}
    </article>
  );
}

export default function TicketsList({ orders, venueAddress }) {
  if (!orders || orders.length === 0) {
    return (
      <div
        style={{
          textAlign: 'center', padding: '48px 20px',
          border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 14,
          color: '#8a8a8a',
        }}
      >
        <div style={{ fontSize: 15, marginBottom: 6, color: '#e0e0e0' }}>No tickets yet.</div>
        <div style={{ fontSize: 13 }}>Buy tickets to an upcoming show and they'll live here.</div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:gap-5 md:grid-cols-2">
      {orders.map((o) => (
        <OrderCard key={o.id} order={o} venueAddress={venueAddress} />
      ))}
    </div>
  );
}
