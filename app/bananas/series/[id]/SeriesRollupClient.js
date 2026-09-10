'use client';

import Link from 'next/link';

function usd(cents) {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function SeriesRollupClient({ series, events, metrics }) {
  const metricsByEvent = Object.fromEntries(metrics.map((row) => [row.event_id, row]));
  const today = new Date().toISOString().slice(0, 10);
  const next = events.find((event) => event.event_date >= today) || null;
  const totals = metrics.reduce((sum, row) => ({
    tickets: sum.tickets + (row.tickets_sold || 0),
    gross: sum.gross + (row.gross_cents || 0),
    net: sum.net + (row.net_cents || 0),
    attendance: sum.attendance + (row.checkins_count ?? row.attendees_count ?? 0),
  }), { tickets: 0, gross: 0, net: 0, attendance: 0 });

  return (
    <div className="max-w-[1120px] space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/bananas?tab=events" className="text-[11px] font-semibold tracking-[0.14em]" style={{ color: 'var(--auth-muted)' }}>← BACK TO EVENTS</Link>
          <h1 className="mt-3 text-[32px] font-extrabold -tracking-[0.02em]" style={{ color: 'var(--auth-text)' }}>{series.title}</h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--auth-muted)' }}>
            {series.recurrence_freq === 'biweekly' ? 'Bi-weekly' : 'Weekly'} · starts {formatDate(series.starts_on)}{series.ends_on ? ` · ends ${formatDate(series.ends_on)}` : ''}
          </p>
        </div>
        <div className="rounded-[12px] border px-4 py-3 text-right" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
          <div className="text-[10px] font-semibold tracking-[0.14em]" style={{ color: 'var(--auth-muted)' }}>NEXT OCCURRENCE</div>
          <div className="mt-1 text-[13px] font-semibold" style={{ color: 'var(--auth-text)' }}>{next ? `${formatDate(next.event_date)} · ${next.status.toUpperCase()}` : 'None scheduled'}</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[14px] border" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
        <table className="w-full min-w-[780px] text-left text-[13px]">
          <thead><tr style={{ color: 'var(--auth-muted)', borderBottom: '1px solid var(--auth-card-border)' }}>
            <th className="px-5 py-3 text-[10px] font-semibold tracking-[0.12em]">OCCURRENCE</th>
            <th className="px-4 py-3 text-[10px] font-semibold tracking-[0.12em]">STATUS</th>
            <th className="px-4 py-3 text-[10px] font-semibold tracking-[0.12em] text-right">SOLD</th>
            <th className="px-4 py-3 text-[10px] font-semibold tracking-[0.12em] text-right">GROSS</th>
            <th className="px-4 py-3 text-[10px] font-semibold tracking-[0.12em] text-right">NET</th>
            <th className="px-5 py-3 text-[10px] font-semibold tracking-[0.12em] text-right">ATTENDANCE</th>
          </tr></thead>
          <tbody>{events.map((event) => {
            const row = metricsByEvent[event.id];
            return <tr key={event.id} style={{ borderBottom: '1px solid var(--auth-card-border)' }}>
              <td className="px-5 py-4"><Link href={`/bananas/events/${event.id}`} className="font-semibold" style={{ color: 'var(--auth-text)' }}>#{event.recurrence_position || '—'} · {formatDate(event.event_date)}</Link></td>
              <td className="px-4 py-4" style={{ color: 'var(--auth-muted)' }}>{event.status.toUpperCase()}</td>
              <td className="px-4 py-4 text-right">{row?.tickets_sold ?? '—'}</td>
              <td className="px-4 py-4 text-right">{row ? usd(row.gross_cents) : '—'}</td>
              <td className="px-4 py-4 text-right">{row ? usd(row.net_cents) : '—'}</td>
              <td className="px-5 py-4 text-right">{row?.checkins_count ?? row?.attendees_count ?? '—'}</td>
            </tr>;
          })}</tbody>
          <tfoot><tr className="font-bold" style={{ color: 'var(--auth-text)' }}>
            <td colSpan="2" className="px-5 py-4">TOTALS</td><td className="px-4 py-4 text-right">{totals.tickets}</td><td className="px-4 py-4 text-right">{usd(totals.gross)}</td><td className="px-4 py-4 text-right">{usd(totals.net)}</td><td className="px-5 py-4 text-right">{totals.attendance}</td>
          </tr></tfoot>
        </table>
      </div>
    </div>
  );
}
