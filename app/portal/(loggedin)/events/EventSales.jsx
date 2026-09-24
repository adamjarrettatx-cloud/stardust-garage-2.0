'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
const money = (cents, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(cents || 0) / 100);
export default function EventSales({ initial }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(null);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setBusy(true);
    try {
      const response = await fetch(`/api/portal/events/${initial.event.id}/sales`, { cache: 'no-store', signal: controller.signal });
      const next = await response.json();
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) setData(null);
        throw new Error(next.error || 'Sales could not be refreshed.');
      }
      setData(next); setError('');
    } catch (cause) {
      if (cause.name !== 'AbortError') setError(cause.message);
    } finally { inFlight.current = null; setBusy(false); }
  }, [initial.event.id]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = setInterval(onVisible, 15000);
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); inFlight.current?.abort(); };
  }, [refresh]);
  return <main className="my-events">
    <Link className="event-back" href="/portal/events">Back to My Events</Link>
    {data ? <>
      <div className="event-heading"><div><p className="event-date">{data.event.event_date} {data.event.event_time || ''}</p><h1>{data.event.title}</h1></div><button onClick={refresh} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh sales'}</button></div>
      <p className="event-intro">Ticket sales · Updates every 15 seconds while this page is visible.</p>
      <p className="event-asof">Last successful update: {new Date(data.as_of).toLocaleString('en-US', { timeZone: 'America/Chicago' })} Central</p>
      {error && <p role="alert" className="event-error">{error} The figures below are from the last successful update.</p>}
      <section><h2>Stardust Garage ticketing</h2>
        <div className="sales-grid">
          {[['Tickets issued', data.internal.tickets_issued], ['Valid / used tickets', data.internal.tickets_valid], ['Checked in', data.internal.tickets_used], ['Complimentary tickets', data.internal.complimentary_tickets]].map(([label, value]) => <div className="sales-stat" key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
        {data.internal.currencies.map((row) => <div className="sales-grid" key={row.currency}>
          {[['Gross collected', row.gross_collected_cents], ['Refunded', row.refunded_cents], ['Net collected', row.net_collected_cents]].map(([label, value]) => <div className="sales-stat" key={label}><span>{label} · {row.currency}</span><strong>{money(value, row.currency)}</strong></div>)}
        </div>)}
        {!data.internal.currencies.length && <p>No completed Stardust Garage ticket orders yet.</p>}
        <p className="event-note">Collected amounts include checkout fees and taxes. Net collected subtracts recorded refunds; it is not an organizer payout or profit. Complimentary tickets are included in issued tickets and shown separately.</p>
      </section>
      {(data.ticket_tailor.length > 0 || data.event.ticketing_mode === 'tickettailor') && <section><h2>Ticket Tailor history</h2><p className="event-note">Cached external summaries, shown separately and not added to Stardust Garage totals.</p>
        {!data.ticket_tailor.length && <p>No synced summary is available for this event yet.</p>}
        {data.ticket_tailor.map((row, i) => <div className="external-sales" key={i}><p>Last synced: {new Date(row.fetched_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })} Central</p><p>{row.tickets_sold ?? 'Unavailable'} tickets sold · {row.orders_count ?? 'Unavailable'} orders · Gross {row.gross_cents == null ? 'unavailable' : money(row.gross_cents, row.currency)}</p></div>)}
      </section>}
    </> : <p role="alert">{error || 'This event is no longer available to this account.'}</p>}
  </main>;
}
