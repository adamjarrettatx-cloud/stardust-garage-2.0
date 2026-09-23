'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { buildTicketEventGrid, isUsableTicket } from '@/lib/wallet/event-grid';

function EventArtwork({ event }) {
  const [failed, setFailed] = useState(false);
  if (!event?.image_url || failed) return <span className="ticket-artwork-fallback">{event?.title || 'Event details unavailable'}</span>;
  // Preserve the entire supplied flier rather than cropping off event details.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={event.image_url} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

function Receipt({ order }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function resend() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/wallet/resend-tickets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: order.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not send tickets.');
      setMessage('Tickets sent to your account email.');
    } catch (error) { setMessage(error.message || 'Could not send tickets. Please try again.'); }
    finally { setBusy(false); }
  }
  const total = new Intl.NumberFormat('en-US', { style: 'currency', currency: order.currency || 'USD' }).format((order.total_cents || 0) / 100);
  return <div className="ticket-order-receipt">
    <p>Order {order.id} · {total} · {order.status?.replaceAll('_', ' ')}</p>
    {order.status === 'paid' && <button type="button" className="account-hub-text-button" disabled={busy} onClick={resend}>{busy ? 'Sending…' : 'Send to email'}</button>}
    {message && <p role="status">{message}</p>}
  </div>;
}

export default function TicketEventGrid({ orders, initialNow, loadError = false }) {
  const router = useRouter();
  const [now, setNow] = useState(initialNow);
  const [selectedId, setSelectedId] = useState(null);
  const dialog = useRef(null);
  const groups = useMemo(() => buildTicketEventGrid(orders, new Date(now)), [orders, now]);
  const selected = groups.find((group) => group.id === selectedId);
  const hasSelection = Boolean(selected);
  function refresh() { setNow(new Date().toISOString()); router.refresh(); }
  useEffect(() => {
    if (hasSelection) dialog.current?.showModal();
  }, [selectedId, hasSelection]);
  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') { setNow(new Date().toISOString()); router.refresh(); }
    };
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    const timer = window.setInterval(refreshVisible, 60000);
    return () => { window.removeEventListener('focus', refreshVisible); document.removeEventListener('visibilitychange', refreshVisible); window.clearInterval(timer); };
  }, [router]);
  return <section id="tickets" className="profile-tickets" aria-labelledby="profile-tickets-title">
    <div className="profile-tickets-heading"><h2 id="profile-tickets-title">Tickets</h2><button type="button" className="account-hub-text-button" onClick={refresh}>Refresh tickets</button></div>
    {loadError ? <div className="account-hub-panel account-hub-padded" role="alert"><p>Tickets couldn’t be loaded. Your purchases have not been removed.</p><button type="button" className="account-hub-button secondary" onClick={refresh}>Try again</button></div> :
      groups.length ? <div className="ticket-event-grid">
        {groups.map((group) => <button type="button" className={`ticket-event-card${group.muted ? ' is-used' : ''}`} key={group.id}
          onClick={() => setSelectedId(group.id)} data-event-id={group.id} data-status={group.state}
          aria-label={`${group.event?.title || 'Event tickets'} · ${group.state} · ${group.tickets.length} ticket${group.tickets.length === 1 ? '' : 's'}`}
          title={`${group.event?.title || 'Event tickets'} · ${group.state}`} aria-haspopup="dialog">
          <EventArtwork event={group.event} />
        </button>)}
      </div> : <div className="account-hub-panel account-hub-padded"><h3>No tickets yet</h3><p className="account-hub-note">Your purchased tickets will appear here.</p><Link href="/events" className="account-hub-text-button">Browse events →</Link></div>}
    {selected && <dialog ref={dialog} className="account-hub-dialog ticket-detail-dialog" onClose={() => setSelectedId(null)} aria-labelledby="ticket-details-title">
      <div className="account-hub-panel-heading"><h2 id="ticket-details-title">{selected.event?.title || 'Ticket details'}</h2><button type="button" className="account-hub-text-button" onClick={() => dialog.current?.close()}>Close</button></div>
      <div className="account-hub-padded">
        <p className="account-hub-note">{selected.event?.event_date || 'Date unavailable'}{selected.event?.event_time ? ` · ${selected.event.event_time} (Austin time)` : ''}</p>
        {selected.past && <p className="account-hub-note">This event has passed. Your tickets remain here for your records.</p>}
        {!selected.tickets.length && <p className="account-hub-note">Your purchase is recorded. Ticket details are not available yet; refresh or contact Stardust if they do not appear.</p>}
        {selected.orders.map((order) => <section key={order.id}>
          {(order.tickets || []).map((ticket, index) => {
            const item = order.items?.find((row) => row.id === ticket.order_item_id);
            const usable = isUsableTicket(ticket);
            return <details className={`ticket-detail${!usable ? ' is-used' : ''}`} key={ticket.id} open={index === 0}>
              <summary>{item?.product_name_snapshot || 'Ticket'}{item?.tier_name_snapshot ? ` · ${item.tier_name_snapshot}` : ''}<span>{ticket.status === 'used' ? 'Used' : ticket.status === 'valid' || ticket.status === 'active' ? 'Valid' : ticket.status || 'Status unavailable'}</span></summary>
              <div className="ticket-detail-body">
                {usable && ticket._qrSvg ? <div className="ticket-detail-qr" role="img" aria-label={`QR code for ticket ${ticket.ticket_code}`} dangerouslySetInnerHTML={{ __html: ticket._qrSvg }} /> : <p>This ticket is {ticket.status || 'unavailable'} and cannot be used for entry.</p>}
                <p className="ticket-detail-code">{ticket.ticket_code}</p>
              </div>
            </details>;
          })}
          <Receipt order={order} />
        </section>)}
      </div>
    </dialog>}
  </section>;
}
