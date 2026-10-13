'use client';

import { useEffect, useMemo, useState } from 'react';
import { matchesRosterSearch, rosterCsv, rosterTickets, sortRoster } from '@/lib/tickets/event-roster';
import RefundDialog from '@/components/ticketing/RefundDialog';
import RefundActivity from '@/components/ticketing/RefundActivity';
import CompDialog from '@/components/ticketing/CompDialog';
import styles from './roster.module.css';

function money(cents, currency = 'usd') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents || 0) / 100);
}
function when(value) {
  return value ? new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value)) : 'Not checked in';
}
function statusLabel(status) {
  return ({ used: 'Checked in', valid: 'Not checked in', partial_refund: 'Partial refund' })[status]
    || status.replaceAll('_', ' ');
}
function Status({ value }) {
  return <span className={styles.status} data-status={value}>{statusLabel(value)}</span>;
}

export default function EventAttendeesClient({ event, deskMode = false }) {
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState('purchasers');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [loadedAt, setLoadedAt] = useState(null);
  const [page, setPage] = useState(0);
  const [eventFilter, setEventFilter] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [refundOrders, setRefundOrders] = useState(null);
  const [emailState, setEmailState] = useState({});
  const [compOpen, setCompOpen] = useState(false);
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const eventId = event?.id;

  useEffect(() => {
    const orderId = new URLSearchParams(window.location.search).get('order');
    if (orderId) setSearch(orderId);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setBusy(true);
      setError('');
      setOrders([]);
      setLoadedAt(null);
      try {
        const collected = new Map();
        let next = 0;
        do {
          const url = eventId ? `/api/admin/events/${eventId}/attendees?page=${next}` : `/api/admin/tickets/roster?page=${next}`;
          const res = await fetch(url, {
            cache: 'no-store', signal: controller.signal,
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Could not load attendees');
          for (const order of data.orders) collected.set(order.id, order);
          next = data.next_page;
        } while (next !== null);
        if (!controller.signal.aborted) {
          setOrders([...collected.values()]);
          setLoadedAt(new Date().toISOString());
        }
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }
    load();
    return () => controller.abort();
  }, [eventId, reload]);

  // Filter changes intentionally clear selection. No invisible orders are
  // carried into a batch after switching event, view, or search.
  useEffect(() => { setSelected(new Set()); }, [search, status, tab, eventFilter, reload, sort]);

  const tickets = useMemo(() => rosterTickets(orders), [orders]);
  const filteredRows = useMemo(() => (tab === 'purchasers' ? orders : tickets)
    .filter((row) => (eventFilter === 'all' || row.event_id === eventFilter)
      && (status === 'all' || row.status === status) && matchesRosterSearch(row, search)),
  [orders, tickets, tab, status, search, eventFilter]);
  const rows = useMemo(() => sortRoster(filteredRows, tab, sort.key, sort.dir), [filteredRows, tab, sort]);
  // First click sorts ascending, the next click on the same column flips it.
  function sortBy(key) {
    setSort((current) => ({ key, dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc' }));
    setPage(0);
  }
  const events = useMemo(() => [...new Map(orders.map((o) => [o.event_id,
    { id: o.event_id, title: o.event_title, date: o.event_date }])).values()]
    .sort((a, b) => (b.date || '').localeCompare(a.date || '')), [orders]);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  // Event counts are shown only for one event: the event page, or the
  // Orders & Refunds page after a specific event is picked. They follow the
  // Event filter only, never search or status, and are hidden for All events.
  const scopedEvent = event
    ? { id: event.id, title: event.title }
    : eventFilter !== 'all' ? events.find((item) => item.id === eventFilter) : null;
  const eventCounts = useMemo(() => {
    if (!scopedEvent) return null;
    const inEvent = (row) => !!event || row.event_id === scopedEvent.id;
    const scopedOrders = orders.filter(inEvent);
    const scopedTickets = tickets.filter(inEvent);
    return [
      ['purchasers', new Set(scopedOrders.filter((o) => ['paid', 'partial_refund'].includes(o.status))
        .map((o) => o.buyer_email?.trim().toLowerCase() || o.id)).size],
      ['active tickets', scopedTickets.filter((t) => ['valid', 'used'].includes(t.status)).length],
      ['checked in', scopedTickets.filter((t) => t.status === 'used').length],
      ['not checked in', scopedTickets.filter((t) => t.status === 'valid').length],
    ];
  }, [scopedEvent?.id, event, orders, tickets]);
  const eligible = tab === 'purchasers' ? rows.filter((row) => row.can_refund) : [];
  const pageEligible = visible.filter((row) => row.can_refund);
  function toggleOrder(id) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 100) next.add(id);
      return next;
    });
  }
  function togglePage() {
    setSelected((current) => {
      const next = new Set(current);
      if (pageEligible.every((row) => next.has(row.id))) pageEligible.forEach((row) => next.delete(row.id));
      else pageEligible.forEach((row) => { if (next.size < 100) next.add(row.id); });
      return next;
    });
  }
  function refreshed() { setReload((n) => n + 1); }

  // Sends the order's tickets to the purchaser's email and waits for the
  // email provider to accept it, so "Sent" means the email actually left.
  async function sendTickets(row) {
    setEmailState((s) => ({ ...s, [row.id]: { status: 'sending' } }));
    try {
      const res = await fetch(`/api/admin/tickets/orders/${row.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resend' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Send failed');
      setEmailState((s) => ({ ...s, [row.id]: { status: 'sent', to: data.to, at: data.sent_at } }));
    } catch (err) {
      setEmailState((s) => ({ ...s, [row.id]: { status: 'failed', error: err.message } }));
    }
  }

  function exportCsv() {
    const csv = tab === 'purchasers'
      ? rosterCsv(
        ['Purchaser name', 'Email', 'Event', 'Order status', 'Tickets', 'Checked in', 'Total', 'Refunded', 'Currency', 'Purchased at', 'Order ID'],
        rows.map((o) => [o.buyer_name, o.buyer_email, o.event_title, o.status, o.tickets.length,
          o.tickets.filter((t) => t.status === 'used').length, (o.total_cents || 0) / 100,
          (o.refunded_cents || 0) / 100, o.currency, o.purchased_at, o.id]),
      )
      : rosterCsv(
        ['Attendee name', 'Purchaser name', 'Purchaser email', 'Attendee email', 'Ticket type', 'Tier', 'Ticket status', 'Checked in at', 'Order status', 'Ticket ID', 'Order ID'],
        rows.map((t) => [t.attendee_name, t.buyer_name, t.buyer_email, t.attendee_email,
          t.product_name, t.tier_name, t.status, t.used_at, t.order_status, t.id, t.order_id]),
      );
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${event ? `${event.event_date}-${event.id}` : 'all-events'}-${tab}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className={styles.roster} aria-busy={busy}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{event ? 'ATTENDEES & ORDERS' : 'TICKET ORDERS'}</p>
          <h1>{event?.title || 'Orders & Refunds'}</h1>
          <p className={styles.muted}>{event ? new Intl.DateTimeFormat('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
          }).format(new Date(`${event.event_date}T12:00:00`)) : 'Search purchases across all SDG-ticketed events.'}</p>
        </div>
        <div className={styles.actions}>
          {event ? <>
            <a className={styles.button} href="/bananas/orders">Search all orders</a>
            <a className={styles.button} href={`/bananas/events/${event.id}`}>Edit event</a>
            {!deskMode && <button className={styles.button} onClick={() => setCompOpen(true)}>Issue comp</button>}
          </> : deskMode ? <a className={styles.button} href="/capacity/front-desk">Back to front desk</a>
            : <a className={styles.button} href="/bananas?tab=events">Events</a>}
          <button className={styles.button} disabled={busy} onClick={() => setReload((n) => n + 1)}>
            {busy ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </header>

      {event && event.ticketing_mode !== 'internal' && (
        <p className={styles.notice}>This list contains SDG checkout purchases only. Ticket Tailor and other external ticket purchases are not included. Complimentary guest lists and trial-pass visits are separate.</p>
      )}

      <div className={styles.panel}>
        <div className={styles.toolbar}>
          <div className={styles.tabs} role="group" aria-label="Roster view">
            {['purchasers', 'tickets'].map((value) => (
              <button key={value} className={styles.button} aria-pressed={tab === value}
                onClick={() => { setTab(value); setStatus('all'); setSort({ key: null, dir: 'asc' }); setPage(0); }}>
                {value === 'purchasers' ? 'Purchasers' : 'Tickets & check-ins'}
              </button>
            ))}
          </div>
          <button className={styles.button} disabled={busy || !!error || !rows.length} onClick={exportCsv}>
            Export CSV
          </button>
        </div>
        <div className={styles.filters}>
          <label className={styles.search}>
            <span>Search name, email, or order ID</span>
            <input type="search" placeholder="Search name, email, or order ID…" value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          </label>
          {!event && <label>
            <span>Event</span>
            <select aria-label="Event" value={eventFilter} onChange={(e) => { setEventFilter(e.target.value); setPage(0); }}>
              <option value="all">All events</option>
              {events.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.date}</option>)}
            </select>
          </label>}
          <label>
            <span>{tab === 'purchasers' ? 'Order status' : 'Ticket status'}</span>
            <select aria-label={tab === 'purchasers' ? 'Order status' : 'Ticket status'} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
              <option value="all">All statuses</option>
              {(tab === 'purchasers'
                ? ['paid', 'partial_refund', 'refunded', 'pending', 'failed', 'void']
                : ['valid', 'used', 'refunded', 'void']).map((value) => (
                <option key={value} value={value}>{statusLabel(value)}</option>
              ))}
            </select>
          </label>
        </div>
        {eventCounts && (
          <p className={styles.summary} aria-live="polite">
            <span className={styles.summaryScope}>{scopedEvent.title || 'Selected event'}</span>
            {eventCounts.map(([label, value]) => (
              <span key={label} className={styles.summaryItem}>
                <strong>{busy || error ? '—' : value}</strong> {label}
              </span>
            ))}
          </p>
        )}
        <p className={styles.explanation}>
          {tab === 'purchasers'
            ? 'One row per order. Select orders for full remaining-balance refunds, or use Refund on a row for a partial amount. Maximum 100 orders per batch.'
            : 'One row per ticket. When a guest name was not collected, the purchaser is shown and labeled. Ticket scans do not identify unnamed guests.'}
        </p>
        {tab === 'purchasers' && !busy && !error && (
          <div className={styles.selectionBar}>
            <span>{selected.size} selected</span>
            <button className={styles.button} disabled={!eligible.length || eligible.length > 100}
              onClick={() => setSelected(new Set(eligible.map((row) => row.id)))}>
              Select all {eligible.length} matching refundable orders
            </button>
            <button className={styles.button} disabled={!selected.size} onClick={() => setSelected(new Set())}>Clear</button>
            <button className={styles.primaryButton} disabled={!selected.size}
              onClick={() => setRefundOrders(orders.filter((row) => selected.has(row.id)))}>
              Refund selected{selected.size ? ` (${selected.size})` : ''}
            </button>
            {eligible.length > 100 && <span className={styles.secondary}>Narrow your filters or select up to 100 orders.</span>}
          </div>
        )}

        {error ? <div className={styles.empty} role="alert"><strong>Unable to load the list</strong><p>{error}</p><button className={styles.button} onClick={() => setReload((n) => n + 1)}>Try again</button></div>
          : busy ? <div className={styles.empty} role="status">Loading names and tickets…</div>
          : !rows.length ? <div className={styles.empty}>{search || status !== 'all' || eventFilter !== 'all' ? 'No matches. Try another name or clear your filters.' : 'No SDG ticket orders found.'}</div>
          : (
            <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={tab === 'purchasers' ? 'Purchaser list' : 'Ticket list'}>
              <table>
                <thead><tr>
                  {tab === 'purchasers' && <th scope="col"><input type="checkbox" aria-label="Select refundable orders on this page"
                    checked={pageEligible.length > 0 && pageEligible.every((row) => selected.has(row.id))}
                    disabled={!pageEligible.length} onChange={togglePage} /></th>}
                  {(tab === 'purchasers'
                  ? [['Purchaser', 'purchaser'], ...(!event ? [['Event', 'event']] : []), ['Order status', 'status'], ['Tickets', 'tickets'],
                    ['Checked in', 'checked_in'], ['Total / refunded', 'total'], ['Actions']]
                  : [['Attendee / purchaser', 'attendee'], ...(!event ? [['Event', 'event']] : []), ['Ticket type', 'type'],
                    ['Ticket status', 'status'], ['Checked in (Austin)', 'checked_in'], ['Order', 'order']]
                ).map(([label, key]) => {
                  if (!key) return <th key={label} scope="col">{label}</th>;
                  const active = sort.key === key;
                  return (
                    <th key={label} scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button type="button" className={styles.sortButton} data-active={active} onClick={() => sortBy(key)}
                        title={active && sort.dir === 'asc' ? `Sort ${label} descending` : `Sort ${label} ascending`}>
                        {label}
                        <span className={styles.sortIcon} aria-hidden="true">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                      </button>
                    </th>
                  );
                })}</tr></thead>
                <tbody>
                  {visible.map((row) => tab === 'purchasers' ? (
                    <tr key={row.id}>
                      <td className={styles.checkCell}><input type="checkbox" aria-label={`Select order ${row.id} for ${row.buyer_name || row.buyer_email}`}
                        checked={selected.has(row.id)} disabled={!row.can_refund || (!selected.has(row.id) && selected.size >= 100)}
                        onChange={() => toggleOrder(row.id)} /></td>
                      <td className={styles.personCell}><strong>{row.buyer_name || 'Name not provided'}</strong><span className={styles.secondary}>{row.buyer_email || 'No email'}</span>
                        <span className={styles.secondary}>Order {row.id.slice(0, 8)} · {when(row.purchased_at)}</span></td>
                      {!event && <td>{deskMode ? row.event_title || 'Event' : <a href={`/bananas/events/${row.event_id}/attendees`}>{row.event_title || 'Event'}</a>}<span className={styles.secondary}>{row.event_date}</span></td>}
                      <td><Status value={row.status} /></td>
                      <td>{row.tickets.length}</td>
                      <td>{row.tickets.filter((t) => t.status === 'used').length} / {row.tickets.length}</td>
                      <td>{money(row.total_cents, row.currency)}{row.is_comp && <span className={styles.secondary}>Comp</span>}{row.refunded_cents > 0 && <span className={styles.secondary}>{money(row.refunded_cents, row.currency)} refunded</span>}</td>
                      <td>
                        {['paid', 'partial_refund'].includes(row.status) && row.buyer_email && (() => {
                          const st = emailState[row.id] || {};
                          return <div className={styles.sendCell}>
                            <button className={styles.primaryButton} disabled={st.status === 'sending'} onClick={() => sendTickets(row)}>
                              {st.status === 'sending' ? 'Sending…' : st.status === 'sent' ? 'Send again' : 'Send to their email'}
                            </button>
                            {st.status === 'sent' && <span className={styles.sentNote} role="status">Sent to {st.to} at {new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(new Date(st.at))}</span>}
                            {st.status === 'failed' && <span className={styles.failedNote} role="alert">Not sent: {st.error}</span>}
                          </div>;
                        })()}
                        {row.can_refund ? <button className={styles.button} onClick={() => setRefundOrders([row])}>Refund</button>
                        : <span className={styles.secondary}>{row.status === 'refunded' ? 'Fully refunded' : row.is_comp ? 'Comp · no payment' : 'Not refundable'}</span>}</td>
                    </tr>
                  ) : (
                    <tr key={row.id}>
                      <td className={styles.personCell}>
                        <strong>{row.attendee_name || row.buyer_name || 'Name not provided'}</strong>
                        <span className={styles.secondary}>{row.attendee_name
                          ? `Purchaser: ${row.buyer_name || row.buyer_email || 'Name not provided'}`
                          : 'Purchaser name · guest name not collected'}</span>
                        <span className={styles.secondary}>{row.attendee_email || row.buyer_email || 'No email'}</span>
                      </td>
                      {!event && <td>{row.event_title || 'Event'}</td>}
                      <td>{row.product_name}<span className={styles.secondary}>{row.tier_name}</span></td>
                      <td><Status value={row.status} /></td>
                      <td>{when(row.used_at)}</td>
                      <td><Status value={row.order_status} /><span className={styles.secondary}>{row.order_id.slice(0, 8)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {!busy && !error && (
          <footer className={styles.footer}>
            <span>{rows.length} {tab === 'purchasers' ? 'orders' : 'tickets'}{loadedAt ? ` · Updated ${when(loadedAt)}` : ''}</span>
            {pageCount > 1 && <div className={styles.actions}>
              <button className={styles.button} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
              <span>{currentPage + 1} / {pageCount}</span>
              <button className={styles.button} disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button>
            </div>}
          </footer>
        )}
      </div>
      <RefundActivity eventId={eventId} refresh={reload} onChange={refreshed} />
      {!event && <p className={styles.explanation}>SDG checkout orders only. Ticket Tailor purchases, memberships, guest-list allocations, and trial passes are not included.</p>}
      {compOpen && event && <CompDialog event={event} onClose={() => setCompOpen(false)} onDone={refreshed} />}
      {refundOrders && <RefundDialog orders={refundOrders} onClose={() => setRefundOrders(null)} onDone={refreshed} />}
    </section>
  );
}
