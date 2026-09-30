'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { availabilityDays } from '@/lib/calendar-availability';
import StationSessionControls from '@/app/components/StationSessionControls';
import Wordmark from '@/app/components/Wordmark';
import styles from './availability.module.css';

export default function AvailabilityCalendar() {
  const [days, setDays] = useState(null);
  const [month, setMonth] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [light, setLight] = useState(false);
  const controller = useRef(null);
  const load = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true); setDays(null); setError('');
    try {
      const res = await fetch('/api/station/availability', { cache: 'no-store', signal: request.signal });
      if (res.status === 401) { window.location.replace('/staff/login?expired=1'); return; }
      if (!res.ok) throw new Error('unavailable');
      const body = await res.json();
      const safe = availabilityDays(body.days);
      if (request.signal.aborted) return;
      setDays(safe);
      setMonth(value => safe.some(day => day.date.startsWith(value)) && value ? value : safe[0].date.slice(0,7));
    } catch {
      if (!request.signal.aborted) { setDays(null); setError('Availability could not be verified. Please refresh before planning a date.'); }
    } finally { if (!request.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    setLight(window.matchMedia?.('(prefers-color-scheme: light)').matches || false);
    void load();
    const timer = setInterval(load, 60000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); controller.current?.abort(); };
  }, [load]);
  const months = days ? [...new Set(days.map(day => day.date.slice(0,7)))] : [];
  const visible = days?.filter(day => day.date.startsWith(month)) || [];
  const dateLabel = value => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const offset = visible.length ? new Date(`${visible[0].date}T12:00:00Z`).getUTCDay() : 0;
  return <main className={`${styles.page} ${light ? styles.light : ''}`}>
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div className={styles.brand}><Wordmark size="sm" /><span>CALENDAR ACCESS</span></div>
        <div className={styles.actions}><button onClick={() => setLight(!light)}>{light ? 'Dark view' : 'Light view'}</button><StationSessionControls /></div>
      </header>
      <div className={styles.intro}><p className={styles.eyebrow}>AVAILABILITY ONLY</p><h1>Find an open date.</h1>
        <p>View available dates at Stardust Garage. Event details are private.</p></div>
      <section className={styles.panel} aria-label="Calendar availability">
        <div className={styles.toolbar}>
          <label>Month<select aria-label="Month" value={month} disabled={!days} onChange={e => setMonth(e.target.value)}>
            {months.map(value => <option key={value} value={value}>{dateLabel(`${value}-01`)}</option>)}
          </select></label>
          <button onClick={load} disabled={loading}>{loading ? 'Checking…' : 'Refresh availability'}</button>
        </div>
        <div className={styles.legend}><span><i className={styles.openDot} />Available</span><span><i className={styles.closedDot} />Unavailable</span><span>Dates in Austin time</span></div>
        <div role="status" aria-live="polite">{loading && <p className={styles.message}>Checking current availability…</p>}</div>
        {error && <p role="alert" className={styles.message}>{error}</p>}
        {days && <div className={styles.grid} aria-label={dateLabel(`${month}-01`)}>
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => <div key={day} className={styles.weekday}>{day}</div>)}
          {Array.from({ length: offset }, (_, i) => <div key={`blank-${i}`} aria-hidden="true" />)}
          {visible.map(day => <div role="group" key={day.date} className={`${styles.day} ${day.available ? styles.open : styles.closed}`}
            aria-label={`${day.date}: ${day.available ? 'Available' : 'Unavailable'}`}>
            <time dateTime={day.date}>{Number(day.date.slice(-2))}</time>
            <span className={styles.status}>{day.available ? 'Available' : 'Unavailable'}</span>
            <i className={styles.mobileDot} aria-hidden="true" />
          </div>)}
        </div>}
      </section>
      <footer className={styles.footer}><span>READ-ONLY ACCESS</span><p>Availability is not a reservation. Contact SDG to confirm a date.<br />Showing the next 365 days. Automatically checked every minute.</p></footer>
    </div>
  </main>;
}
