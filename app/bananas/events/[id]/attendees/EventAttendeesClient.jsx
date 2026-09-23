'use client';

import { useEffect, useMemo, useState } from 'react';
import { matchesRosterSearch, rosterCsv, rosterTickets } from '@/lib/tickets/event-roster';
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

export default function EventAttendeesClient({ event }) {
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState('purchasers');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [loadedAt, setLoadedAt] = useState(null);
  const [page, setPage] = useState(0);

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
          const res = await fetch(`/api/admin/events/${event.id}/attendees?page=${next}`, {
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
  }, [event.id, reload]);

  const tickets = useMemo(() => rosterTickets(orders), [orders]);
  const rows = useMemo(() => (tab === 'purchasers' ? orders : tickets)
    .filter((row) => (status === 'all' || row.status === status) && matchesRosterSearch(row, search)),
  [orders, tickets, tab, status, search]);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const validTickets = tickets.filter((t) => ['valid', 'used'].includes(t.status));
  const uniquePurchasers = new Set(orders.filter((o) => ['paid', 'partial_refund'].includes(o.status))
    .map((o) => o.buyer_email?.trim().toLowerCase() || o.id)).size;

  function exportCsv() {
    const csv = tab === 'purchasers'
      ? rosterCsv(
        ['Purchaser name', 'Email', 'Order status', 'Tickets', 'Checked in', 'Total', 'Refunded', 'Currency', 'Purchased at', 'Order ID'],
        rows.map((o) => [o.buyer_name, o.buyer_email, o.status, o.tickets.length,
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
    a.download = `${event.event_date}-${event.id}-${tab}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className={styles.roster} aria-busy={busy}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>ATTENDEES &amp; ORDERS</p>
          <h1>{event.title}</h1>
          <p className={styles.muted}>{new Intl.DateTimeFormat('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
          }).format(new Date(`${event.event_date}T12:00:00`))}</p>
        </div>
        <div className={styles.actions}>
          <a className={styles.button} href={`/bananas/events/${event.id}`}>Edit event</a>
          <a className={styles.button} href={`/admin/tickets/${event.id}`}>Refunds &amp; ticket tools</a>
          <button className={styles.button} disabled={busy} onClick={() => setReload((n) => n + 1)}>
            {busy ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </header>

      {event.ticketing_mode !== 'internal' && (
        <p className={styles.notice}>This list contains SDG checkout purchases only. Ticket Tailor and other external ticket purchases are not included. Complimentary guest lists and trial-pass visits are separate.</p>
      )}

      <div className={styles.metrics}>
        {[
          ['Purchasers', uniquePurchasers],
          ['Active tickets', validTickets.length],
          ['Checked in', tickets.filter((t) => t.status === 'used').length],
          ['Not checked in', tickets.filter((t) => t.status === 'valid').length],
        ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{busy || error ? '—' : value}</strong></div>)}
      </div>

      <div className={styles.panel}>
        <div className={styles.toolbar}>
          <div className={styles.tabs} role="group" aria-label="Roster view">
            {['purchasers', 'tickets'].map((value) => (
              <button key={value} className={styles.button} aria-pressed={tab === value}
                onClick={() => { setTab(value); setStatus('all'); setPage(0); }}>
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
            <span>Search names or email</span>
            <input type="search" placeholder="Search names or email…" value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          </label>
          <label>
            <span>{tab === 'purchasers' ? 'Order status' : 'Ticket status'}</span>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
              <option value="all">All statuses</option>
              {(tab === 'purchasers'
                ? ['paid', 'partial_refund', 'refunded', 'pending', 'failed', 'void']
                : ['valid', 'used', 'refunded', 'void']).map((value) => (
                <option key={value} value={value}>{statusLabel(value)}</option>
              ))}
            </select>
          </label>
        </div>
        <p className={styles.explanation}>
          {tab === 'purchasers'
            ? 'One row per order. Names come from checkout or the linked member profile. A purchaser may have bought multiple tickets.'
            : 'One row per ticket. When a guest name was not collected, the purchaser is shown and labeled. Ticket scans do not identify unnamed guests.'}
        </p>

        {error ? <div className={styles.empty} role="alert"><strong>Unable to load the list</strong><p>{error}</p><button className={styles.button} onClick={() => setReload((n) => n + 1)}>Try again</button></div>
          : busy ? <div className={styles.empty} role="status">Loading names and tickets…</div>
          : !rows.length ? <div className={styles.empty}>{search || status !== 'all' ? 'No matches. Try another name or clear your filters.' : 'No SDG ticket orders for this event yet.'}</div>
          : (
            <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={tab === 'purchasers' ? 'Purchaser list' : 'Ticket list'}>
              <table>
                <thead><tr>{(tab === 'purchasers'
                  ? ['Purchaser', 'Order status', 'Tickets', 'Checked in', 'Total paid', 'Purchased (Austin)']
                  : ['Attendee / purchaser', 'Ticket type', 'Ticket status', 'Checked in (Austin)', 'Order']
                ).map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
                <tbody>
                  {visible.map((row) => tab === 'purchasers' ? (
                    <tr key={row.id}>
                      <td><strong>{row.buyer_name || 'Name not provided'}</strong><span className={styles.secondary}>{row.buyer_email || 'No email'}</span></td>
                      <td><Status value={row.status} /></td>
                      <td>{row.tickets.length}</td>
                      <td>{row.tickets.filter((t) => t.status === 'used').length} / {row.tickets.length}</td>
                      <td>{money(row.total_cents, row.currency)}{row.refunded_cents > 0 && <span className={styles.secondary}>{money(row.refunded_cents, row.currency)} refunded</span>}</td>
                      <td>{when(row.purchased_at)}</td>
                    </tr>
                  ) : (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.attendee_name || row.buyer_name || 'Name not provided'}</strong>
                        <span className={styles.secondary}>{row.attendee_name
                          ? `Purchaser: ${row.buyer_name || row.buyer_email || 'Name not provided'}`
                          : 'Purchaser name · guest name not collected'}</span>
                        <span className={styles.secondary}>{row.attendee_email || row.buyer_email || 'No email'}</span>
                      </td>
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
    </section>
  );
}
