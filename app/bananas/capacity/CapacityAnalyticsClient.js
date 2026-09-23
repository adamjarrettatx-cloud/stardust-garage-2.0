'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { capacityCsv, capacityWhen, capacityHourLabel } from '@/lib/capacity/analytics';
import styles from './capacity.module.css';

const API = '/api/admin/capacity-analytics';
const number = (v) => v == null ? '—' : v.toLocaleString('en-US');

export default function CapacityAnalyticsClient({ initialEvent = null }) {
  const [catalogue, setCatalogue] = useState(null);
  const [catalogueError, setCatalogueError] = useState('');
  const [selection, setSelection] = useState(initialEvent ? `e:${initialEvent}` : '');
  const [mode, setMode] = useState('history');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [view, setView] = useState('capacity');
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [allHours, setAllHours] = useState(false);
  const [picked, setPicked] = useState(null);

  const loadCatalogue = useCallback(async () => {
    setCatalogueError('');
    try {
      const result = await adminFetch(API, { cache: 'no-store' });
      setCatalogue(result.catalogue);
      setSelection((current) => current || (() => {
        const past = result.catalogue.events.find((e) => e.date < result.catalogue.today && e.hasSession);
        return past ? `e:${past.id}` : result.catalogue.nights[0] ? `n:${result.catalogue.nights[0].date}` : result.catalogue.events[0] ? `e:${result.catalogue.events[0].id}` : '';
      })());
    } catch (e) { setCatalogueError(e.message); }
  }, []);

  useEffect(() => { loadCatalogue(); }, [loadCatalogue]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (mode === 'history' && !selection) { setBusy(false); return; }
    const controller = new AbortController();
    let timer;
    let active = true;
    setData(null); setPicked(null); setError(''); setBusy(true);
    const query = mode === 'live' ? 'mode=live'
      : selection.startsWith('e:') ? `mode=event&event=${encodeURIComponent(selection.slice(2))}`
        : `mode=night&date=${encodeURIComponent(selection.slice(2))}`;
    async function load() {
      try {
        const result = await adminFetch(`${API}?${query}&interval=${intervalMinutes}`, { cache: 'no-store', signal: controller.signal });
        if (!active) return;
        setData(result); setError(''); setBusy(false); setClock(Date.now());
        // End recursive polling when a historical view rolls into the past.
        if (mode === 'live' || result.report?.isCurrent) timer = setTimeout(load, 15000);
      } catch (e) {
        if (!active || e.name === 'AbortError') return;
        setError(e.message); setBusy(false);
        timer = setTimeout(load, 15000);
      }
    }
    load();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [mode, selection, refresh, intervalMinutes]);

  const report = data?.report;
  const summary = report?.summary;
  const intervalName = report?.intervalMinutes === 5 ? '5-minute' : 'Hourly';
  const title = data?.event?.title || (mode === 'live' ? 'Current operating night' : report ? `Operating night · ${report.date}` : 'Event history');
  const stale = Boolean(data && (error || ((mode === 'live' || report?.isCurrent) && clock - new Date(data.fetchedAt).getTime() > 45000)));
  const buckets = useMemo(() => {
    if (!report) return [];
    if (allHours) return report.buckets;
    const indices = report.buckets.map((b, i) => (b.entries || b.exits || b.corrections) ? i : -1).filter((i) => i >= 0);
    if (!indices.length) return report.buckets;
    return report.buckets.slice(indices[0], report.isCurrent ? undefined : indices.at(-1) + 1);
  }, [report, allHours]);
  const selected = buckets.find((b) => b.start === picked) || buckets.find((b) => b.peak === summary?.peak) || buckets[0];

  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([capacityCsv(report, title)], { type: 'text/csv;charset=utf-8;' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `capacity-${report.date}-${report.intervalMinutes || 60}min.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className={styles.root}>
      <p className={styles.eyebrow}>VENUE OPERATIONS</p>
      <h1>Event Capacity</h1>
      <p>See when the room filled, how busy it got, and when people left.</p>
      <div className={styles.tabs} aria-label="Capacity views">
        <button className={mode === 'history' ? styles.activeTab : ''} aria-pressed={mode === 'history'} onClick={() => setMode('history')}>Event history</button>
        <button className={mode === 'live' ? styles.activeTab : ''} aria-pressed={mode === 'live'} onClick={() => setMode('live')}>Live counter</button>
      </div>
      {catalogueError && <div role="alert" className={styles.notice}>{catalogueError} <button onClick={loadCatalogue}>Retry event list</button></div>}
      {mode === 'history' && <div className={styles.picker}>
        <label>EVENT / OPERATING NIGHT
          <select value={selection} onChange={(e) => setSelection(e.target.value)} disabled={!catalogue}>
            {!selection && <option value="">{catalogue ? 'No events or operating nights recorded' : 'Loading events…'}</option>}
            {initialEvent && !catalogue?.events.some((e) => `e:${e.id}` === selection) && selection.startsWith('e:') && <option value={selection}>Selected event</option>}
            <optgroup label="Published events">{catalogue?.events.map((e) => <option key={e.id} value={`e:${e.id}`}>{e.date} · {e.title}{e.shared ? ' · shared date' : ''}</option>)}</optgroup>
            <optgroup label="Venue operating nights (including unlinked history)">{catalogue?.nights.map((n) => <option key={n.date} value={`n:${n.date}`}>{n.date} · {n.eventCount ? `${n.eventCount} published event(s)` : 'Unlinked venue history'}</option>)}</optgroup>
          </select>
        </label>
        <button onClick={download} disabled={!report || busy}>Export CSV</button>
      </div>}
      <div className={styles.intervalControl}>
        <span>Chart interval</span>
        <div className={styles.toggle} aria-label="Chart interval">
          {[[5, '5 min'], [60, 'Hourly']].map(([minutes, label]) => <button key={minutes}
            aria-pressed={intervalMinutes === minutes} className={intervalMinutes === minutes ? styles.selectedToggle : ''}
            onClick={() => setIntervalMinutes(minutes)}>{label}</button>)}
        </div>
      </div>
      <div className={styles.freshness}>
        <span role="status">{busy ? 'Loading complete history…' : stale ? 'STALE DATA · Last successful update ' + capacityWhen(data?.fetchedAt) : data ? `${mode === 'live' || report?.isCurrent ? 'Auto-refresh every 15s · ' : ''}Loaded ${capacityWhen(data.fetchedAt)}` : 'Select an event or operating night.'}</span>
        <button onClick={() => setRefresh((v) => v + 1)} disabled={busy || (mode === 'history' && !selection)}>Refresh</button>
      </div>
      {error && <div role="alert" className={styles.notice}>{error} {data ? 'Previously loaded values remain visible and may be stale.' : 'No partial results are displayed.'}</div>}
      {busy && <div className={styles.empty} aria-busy="true">Reading recorded entries, exits, and counter history…</div>}
      {data?.ambiguous && <div className={styles.panel}>
        <h2>{data.event.title}</h2><p className={styles.notice}>{data.message}</p>
        <ul>{data.peers.map((e) => <li key={e.id}>{e.title}</li>)}</ul>
        <button onClick={() => setSelection(`n:${data.date}`)}>View shared operating night</button>
      </div>}
      {report && <>
        <div className={styles.eventTitle}><h2>{title}</h2><span className={styles.chip}>{data.event ? 'DATE-MATCHED' : 'VENUE-WIDE'}</span></div>
        <p className={styles.small}>{capacityWhen(report.window.start)} to {capacityWhen(report.window.end)} · Austin operating window, not event-exclusive attendance.</p>
        {mode === 'live' && <div className={styles.notice}>
          {!data.live?.hasSession ? 'No active capacity session. Start or check the counter in Capacity Setup.' : data.live?.eventTitle ? `Door session selected: ${data.live.eventTitle}. The counter still measures the whole venue, not only that event.` : 'No current-day event session selected. The counter is venue-wide and is not assigned to an event.'}
          {data.live?.staleDoor && ' An old door session is still open; it is not being used to attribute this night.'}
        </div>}
        <div className={styles.stats}>
          {mode === 'live'
            ? <Stat label="Recorded inside now" value={data.live?.count} hint={`${number(data.live?.limit)} configured limit · sampled on refresh`} />
            : <Stat label="Peak recorded inside" value={summary.peak} hint={summary.peakAt ? `${capacityWhen(summary.peakAt)}${summary.limit ? ` · ${Math.round(summary.peak / summary.limit * 100)}% of ${summary.limit}` : ''}` : 'No recorded count'} />}
          <Stat label="Recorded entries" value={summary.entries} hint="Includes repeat entry" />
          <Stat label="Recorded exits" value={summary.exits} hint="Exit counter operations" />
          {mode === 'live'
            ? <Stat label="Peak recorded tonight" value={summary.peak} hint={capacityWhen(summary.peakAt)} />
            : <Stat label="Last recorded count" value={summary.finalCount} hint={`Last movement · ${capacityWhen(summary.lastMovement)}`} />}
        </div>
        {report.warnings.map((warning) => <div className={styles.notice} key={warning}>{warning}</div>)}
        {!!data.peers?.length && !data.event && <p className={styles.small}>Events on this date: {data.peers.map((e) => e.title).join(' · ')}. These share one venue-wide view.</p>}
        {report.buckets.length === 0 ? <div className={styles.empty}><h2>This operating window has not started</h2><p>Recorded capacity will appear when the window begins and the counter is used.</p></div> : <>
          <section className={styles.panel}>
            <div className={styles.panelHead}><div>
              <h2>{view === 'capacity' ? `${intervalName} recorded capacity` : view === 'traffic' ? `${intervalName} arrivals and departures` : `${intervalName} activity heatmap`}</h2>
              <p>{view === 'capacity' ? 'Highest recorded count in each interval, including its opening count.' : view === 'traffic' ? 'Recorded entry and exit operations in each interval.' : 'Darker cells show higher activity within each row; row scales differ.'}</p>
            </div><div className={styles.toggle} aria-label="Chart type">
              {[['capacity', 'Capacity'], ['traffic', 'In / Out'], ['heatmap', 'Heatmap']].map(([id, label]) => <button key={id} onClick={() => setView(id)} aria-pressed={view === id} className={view === id ? styles.selectedToggle : ''}>{label}</button>)}
            </div></div>
            <div className={styles.chartOptions}>
              <span>{view === 'traffic' ? 'Green: entries · Grey: exits' : view === 'heatmap' ? 'Lighter: lower · Darker: higher · — unavailable' : 'Amber: interval peak · — unavailable'}</span>
              <label><input type="checkbox" checked={allHours} onChange={(e) => setAllHours(e.target.checked)} /> Show full operating window</label>
            </div>
            <CapacityChart buckets={buckets} intervalMinutes={report.intervalMinutes} view={view} selected={selected?.start} onSelect={setPicked} />
            {selected && <div className={styles.detail} aria-live="polite">
              <strong>{capacityWhen(selected.start)} to {capacityHourLabel(selected.end, 5)}</strong><span>Entries <b>{number(selected.entries)}</b></span><span>Exits <b>{number(selected.exits)}</b></span><span>Peak <b>{number(selected.peak)}</b></span><span>Interval-end <b>{number(selected.closing)}</b></span>
              {selected.carried && <span>Carried from the last recorded count; no audit writes in this interval.</span>}
              {selected.coverage !== 'session' && <span>{selected.coverage === 'none' ? 'No session coverage' : 'Partial session coverage'}</span>}
              {selected.corrections > 0 && <span>{selected.corrections} correction(s), net {selected.correctionDelta}</span>}
            </div>}
            <p className={styles.small}>The entire timeline fits this panel; every interval is retained. Hover or tap a bar, or use the interval selector, for exact times and counts. Times use Austin CDT/CST; after-midnight activity stays with the preceding night.</p>
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHead}><div><h2>{intervalName} breakdown</h2><p>Counter operations, not unique attendees. Resets and adjustments are separate from exits.</p></div>{mode === 'live' && <button onClick={download}>Export CSV</button>}</div>
            <div className={styles.scroll}><table><thead><tr><th>Interval start · Austin</th><th>Entries</th><th>Exits</th><th>Net flow</th><th>Peak inside</th><th>Interval-end</th><th>Corrections</th><th>Coverage</th></tr></thead>
              <tbody>{buckets.map((b) => <tr key={b.start}><td>{capacityWhen(b.start)}</td><td>{number(b.entries)}</td><td>{number(b.exits)}</td><td>{b.entries == null || b.exits == null ? '—' : b.entries - b.exits}</td><td>{number(b.peak)}</td><td>{number(b.closing)}</td><td>{b.corrections ? `${b.corrections} (${b.correctionDelta > 0 ? '+' : ''}${b.correctionDelta})` : '—'}</td><td>{b.coverage === 'session' ? b.carried ? 'Carried count' : 'Session recorded' : b.coverage === 'none' ? 'Unavailable' : 'Partial'}</td></tr>)}</tbody>
            </table></div>
          </section>
        </>}
        <details className={styles.method}><summary>How this history is reconstructed</summary>
          <ul><li>Counts come from timestamped capacity audit records, not ticket sales. Entries can include re-entry and manual check-in workflows.</li>
            <li>Event views are date-matched to the 9am-to-9am Austin operating window. This does not prove every counted person attended that event. Multiple events on one date share a venue-wide view instead of receiving duplicate totals.</li>
            <li>Sessions spanning several nights are split into daily windows. Older door-session timing is not trusted for historical attribution because sessions can remain open across nights.</li>
            <li>Missing exits cannot be recovered. Resets, adjustments, and session closure are not departures. No recorded movement is not proof of an empty room.</li>
            <li>Counts carry forward only within recorded capacity-session coverage. Unavailable values, gaps, and ambiguous same-timestamp changes are labeled. Peaks are the highest recorded values, not independently verified occupancy.</li>
            <li>Five-minute and hourly views use the original audit timestamps, not interpolated hourly totals. CSV uses the selected interval and includes the full operating window, UTC boundaries, local time with CDT/CST, correction totals, and coverage. Live counts are sampled every 15 seconds; connection failures show stale data.</li></ul>
        </details>
      </>}
    </div>
  );
}

function Stat({ label, value, hint }) {
  return <div className={styles.stat}><div>{label}</div><strong>{number(value)}</strong><small>{hint}</small></div>;
}

function CapacityChart({ buckets, intervalMinutes = 60, view, selected, onSelect }) {
  const dense = intervalMinutes === 5 || buckets.length > 12;
  const selectedIndex = Math.max(0, buckets.findIndex((b) => b.start === selected));
  const selector = <label className={styles.intervalSlider}>Inspect interval
    <input type="range" min="0" max={Math.max(0, buckets.length - 1)} step="1" value={selectedIndex}
      aria-label="Inspect interval" aria-valuetext={buckets[selectedIndex] ? capacityWhen(buckets[selectedIndex].start) : ''}
      onChange={(e) => onSelect(buckets[Number(e.target.value)].start)} />
  </label>;
  if (view === 'heatmap') return <div className={styles.fitChart} data-capacity-chart="heatmap">
    <div className={styles.heatAxis}><TimeAxis buckets={buckets} /></div>
    <div className={`${styles.heatgrid} ${styles.denseHeatgrid}`}
      style={{ gridTemplateColumns: `90px repeat(${buckets.length},minmax(0,1fr))` }}>
      {[['peak', 'Peak inside'], ['entries', 'Entries'], ['exits', 'Exits']].map(([field, label]) => {
        const max = Math.max(1, ...buckets.map((b) => b[field] || 0));
        return [<span key={field} className={styles.rowLabel}>{label}</span>, ...buckets.map((b) => <button
          key={`${field}:${b.start}`} className={styles.heatcell} onClick={() => onSelect(b.start)} onMouseEnter={() => onSelect(b.start)}
          onFocus={() => onSelect(b.start)} tabIndex={-1}
          title={`${capacityWhen(b.start)} ${label}: ${number(b[field])}`}
          aria-label={`${capacityWhen(b.start)} ${label} ${number(b[field])}`}
          style={{ background: b[field] == null ? 'var(--auth-card-bg-alt)' : `color-mix(in srgb, var(--auth-accent) ${8 + (b[field] / max) * 65}%, var(--auth-card-bg))` }}
        ><span className={dense ? styles.denseValue : ''}>{number(b[field])}</span></button>)];
      })}
    </div>
    {selector}
  </div>;
  const top = Math.max(1, ...buckets.flatMap((b) => view === 'traffic' ? [b.entries || 0, b.exits || 0] : [b.peak || 0, b.limit || 0]));
  const ceiling = Math.max(10, Math.ceil(top / 50) * 50);
  return <div className={styles.fitChart} data-capacity-chart={view}>
    <div className={`${styles.chart} ${styles.denseChart}`}>
      {[0, 0.5, 1].map((f) => <div key={f} className={styles.gridline} style={{ bottom: `${34 + f * 204}px` }}><span>{ceiling * f}</span></div>)}
      {buckets.map((b) => <button key={b.start} className={`${styles.column} ${selected === b.start ? styles.picked : ''}`} onClick={() => onSelect(b.start)}
        onMouseEnter={() => onSelect(b.start)} onFocus={() => onSelect(b.start)} tabIndex={-1}
        title={`${capacityWhen(b.start)}: ${number(b.entries)} entries, ${number(b.exits)} exits, peak ${number(b.peak)}`}
        aria-label={`${capacityWhen(b.start)}: ${number(b.entries)} entries, ${number(b.exits)} exits, peak ${number(b.peak)}`}>
        {(view === 'traffic' ? ['entries', 'exits'] : ['peak']).map((field) => <span key={field} className={`${styles.bar} ${field === 'entries' ? styles.entryBar : field === 'exits' ? styles.exitBar : ''}`}
          style={{ height: `${(b[field] || 0) / ceiling * 100}%` }}><b>{dense ? '' : number(b[field])}</b></span>)}
      </button>)}
      <div className={styles.barAxis}><TimeAxis buckets={buckets} /></div>
    </div>
    {selector}
  </div>;
}

function TimeAxis({ buckets }) {
  const count = Math.min(7, buckets.length);
  return <div className={styles.timeAxis}>{Array.from({ length: count }, (_, i) => {
    const fraction = count > 1 ? i / (count - 1) : 0;
    const bucket = buckets[Math.round(fraction * (buckets.length - 1))];
    return <span key={bucket.start} className={i !== 0 && i !== count - 1 && i !== Math.floor(count / 2) ? styles.extraTick : ''}
      style={{ left: `${fraction * 100}%`, transform: i === 0 ? 'none' : i === count - 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
      {capacityHourLabel(bucket.start, 5).replace(/ (CDT|CST)$/, '')}
    </span>;
  })}</div>;
}
