'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatEventTime } from '@/lib/events/format-event-time';
import styles from './door.module.css';

function dateLabel(date) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })
    .format(new Date(`${date}T12:00:00Z`));
}

function TicketAction({ event }) {
  const status = event.ticket_status;
  if (status === 'available' || status === 'options') {
    // Bind checkout to this specific event, not /door. OAuth and an event
    // change during purchase must never silently move a buyer to a new show.
    return <a className={styles.button} data-testid={`buy-${event.id}`} href={`${event.href}?buy=1`}>
      {status === 'available' ? 'BUY TICKETS' : 'VIEW TICKET OPTIONS'}
    </a>;
  }
  if (status === 'external') {
    return <a className={styles.button} data-testid={`buy-${event.id}`} href={event.ticket_url} rel="noopener noreferrer">BUY TICKETS</a>;
  }
  const label = { closed: 'ONLINE SALES CLOSED', sold_out: 'SOLD OUT', free: 'FREE EVENT' }[status]
    || 'TICKETS UNAVAILABLE';
  return <div className={styles.status} data-testid={`ticket-status-${event.id}`}>
    <strong>{label}</strong><p>{status === 'free' ? 'Please check in with the door team.' : 'Please ask the door team for assistance.'}</p>
  </div>;
}

export default function DoorTickets({ initial }) {
  const [data, setData] = useState(initial);
  const [failed, setFailed] = useState(!initial);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let stopped = false, timer, controller;
    const schedule = payload => {
      const boundary = payload?.next_change_at
        ? Date.parse(payload.next_change_at) - Date.parse(payload.server_now) : 30000;
      timer = setTimeout(refresh, Math.max(1000, Math.min(30000, boundary + 100)));
    };
    async function refresh() {
      clearTimeout(timer);
      controller?.abort();
      const request = new AbortController();
      controller = request;
      const timeout = setTimeout(() => request.abort(), 10000);
      try {
        const response = await fetch('/api/door-events', { cache: 'no-store', signal: request.signal });
        if (!response.ok) throw new Error('Unavailable');
        const payload = await response.json();
        if (!Array.isArray(payload.events) || !['empty', 'current', 'choose'].includes(payload.state)) throw new Error('Invalid');
        if (!stopped && controller === request) {
          setData(payload); setFailed(false); schedule(payload);
        }
      } catch {
        if (!stopped && controller === request) {
          setFailed(true); timer = setTimeout(refresh, 15000);
        }
      } finally { clearTimeout(timeout); }
    }
    function visibility() {
      if (document.visibilityState === 'visible') {
        // Clear stale purchasing controls until the server rechecks on resume.
        setFailed(true); refresh();
      }
    }
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', visibility);
    // Immediately revalidate even an SSR snapshot restored from back/forward.
    refresh();
    return () => {
      stopped = true; clearTimeout(timer); controller?.abort();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', visibility);
    };
  }, [retry]);

  return <main className={styles.page}>
    <header className={styles.header}>
      <Link href="/home" prefetch={false} aria-label="Stardust Garage home" data-testid="door-home">
        <img src="/logos/wordmark-white.svg" alt="Stardust Garage" width="112" height="42" />
      </Link>
    </header>
    <div className={styles.content} aria-live="polite">
      {failed ? <section className={styles.empty} data-testid="door-error">
        <p className={styles.eyebrow}>DOOR TICKETS</p>
        <h1>Unable to check the current event</h1>
        <p>Please try again or ask the door team for assistance.</p>
        <button className={styles.button} onClick={() => setRetry(n => n + 1)} data-testid="door-retry">TRY AGAIN</button>
      </section> : data?.state === 'empty' ? <section className={styles.empty} data-testid="door-empty">
        <p className={styles.eyebrow}>DOOR TICKETS</p>
        <h1>No event is currently happening</h1>
        <p>Tickets for the current event appear here one hour before it starts. If you are waiting in line, please ask the door team.</p>
        <Link className={styles.button} href="/events" prefetch={false} data-testid="door-upcoming">VIEW UPCOMING EVENTS</Link>
      </section> : <>
        {data?.state === 'choose' && <section className={styles.choice}>
          <h1>Choose your event</h1><p>More than one event is happening. Confirm the event you are attending before purchasing.</p>
        </section>}
        {data?.events.map(event => <article key={event.id} className={styles.event} data-testid={`door-event-${event.id}`}>
          <p className={styles.eyebrow}>{Date.parse(event.starts_at) > Date.parse(data.server_now) ? 'STARTING SOON' : 'CURRENT EVENT'}</p>
          {event.image_url && <img className={styles.artwork} src={event.image_url} alt={event.title} />}
          <h1>{event.title}</h1>
          <p className={styles.date}>{dateLabel(event.event_date)}<br />{formatEventTime(event.event_time, event.event_end_time)} · Austin time</p>
          <TicketAction event={event} />
          {['available', 'options', 'external'].includes(event.ticket_status) &&
            <p className={styles.instruction}>Complete your purchase, then have your ticket ready at the door.</p>}
        </article>)}
      </>}
      <footer className={styles.footer}>
        <Link href="/account/tickets" prefetch={false} data-testid="door-wallet">Already purchased? View my tickets</Link>
      </footer>
    </div>
  </main>;
}
