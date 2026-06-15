import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { adminPageGate } from '@/lib/auth-helpers';
import { buildEventAnalytics } from '@/lib/event-analytics';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

const CATEGORY_COLOR = {
  workshop: '#ffb84d', yoga: '#4ade80', party: '#f472b6', other: '#8a8a8a',
};

function fmtDate(s) {
  if (!s) return '—';
  return new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default async function AnalyticsPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  // Access is gated above by adminPageGate(); this is a server component that is
  // never bundled to the browser, so we read with the service-role client rather
  // than depending on RLS to confine rows.
  const supabase = createAdminClient();

  const { data: events } = await supabase
    .from('events')
    .select('id, title, event_date, category, tt_event_series_id, member_discount_percent, discount_codes_generated')
    .order('event_date', { ascending: false })
    .limit(300);

  // Local member-discount-code rows power the engagement metrics.
  const { data: codes } = await supabase
    .from('member_discount_codes')
    .select('event_id, member_id, discount_percent, sent_at, send_scheduled_for')
    .limit(5000);

  const rows = buildEventAnalytics({ events: events || [], codes: codes || [] });

  const totals = rows.reduce(
    (acc, r) => {
      acc.codes += r.memberCodes.total;
      acc.sent += r.memberCodes.sent;
      acc.linked += r.ttSeriesLinked ? 1 : 0;
      return acc;
    },
    { codes: 0, sent: 0, linked: 0 },
  );

  return (
    <main className="max-w-[1100px] mx-auto px-6 py-16">
      <Link
        href="/admin"
        className="text-[12px] tracking-[0.14em] mb-4 inline-block hover:text-white transition-colors"
        style={{ color: '#8a8a8a' }}
      >
        ← BACK TO ADMIN
      </Link>

      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h1
          className="text-[32px] font-extrabold -tracking-[0.02em] leading-[1.1]"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          Event Analytics
        </h1>
        <div className="text-[11px] tracking-[0.18em]" style={{ color: '#8a8a8a' }}>
          ADMIN ONLY
        </div>
      </div>
      <p className="mb-8 text-[14px]" style={{ color: '#8a8a8a' }}>
        Member-code engagement from local data. Live ticket revenue requires the TicketTailor metrics
        integration (see below).
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        {[
          { label: 'Events', value: rows.length },
          { label: 'TT-linked events', value: totals.linked },
          { label: 'Member codes', value: totals.codes },
          { label: 'Codes sent', value: totals.sent },
        ].map((c) => (
          <div key={c.label} className="rounded-[14px] border p-5" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}>
            <div className="text-[10px] font-semibold tracking-[0.14em] uppercase mb-1.5" style={{ color: '#8a8a8a' }}>{c.label}</div>
            <div className="text-[28px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Live TicketTailor metrics — read-only placeholder until API work lands */}
      <div className="rounded-[14px] border p-5 mb-10" style={{ background: '#16140d', borderColor: 'rgba(255,184,77,0.25)' }}>
        <div className="text-[10px] font-semibold tracking-[0.14em] uppercase mb-2" style={{ color: '#ffb84d' }}>
          TicketTailor live metrics — not yet wired
        </div>
        <p className="text-[13px] mb-2" style={{ color: '#c8c8c8' }}>
          Gross revenue, tickets sold, and sell-through projections per event will appear here once the
          read-only TicketTailor reporting pull is scheduled. The pure projection helpers already exist in
          <code className="mx-1" style={{ color: 'white' }}>lib/event-analytics.js</code>
          (<code style={{ color: 'white' }}>summarizeEvent</code>, <code style={{ color: 'white' }}>projectFinalSales</code>),
          fed by the read helpers in <code className="mx-1" style={{ color: 'white' }}>lib/tickettailor.js</code>.
        </p>
        <p className="text-[12px]" style={{ color: '#8a8a8a' }}>
          Next data model needed: a cached <code style={{ color: '#c8c8c8' }}>event_ticket_metrics</code> table
          (event_id, tickets_sold, gross_cents, fees_cents, fetched_at) populated by a cron job that calls
          <code className="mx-1" style={{ color: '#c8c8c8' }}>listOrders()</code>/<code style={{ color: '#c8c8c8' }}>listIssuedTickets()</code>.
          This avoids hitting the TT API on every page load and keeps the dashboard fast and rate-limit-safe.
        </p>
      </div>

      {/* Per-event table */}
      <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase mb-3" style={{ color: '#8a8a8a' }}>
        Member-code engagement by event
      </h2>
      {rows.length === 0 ? (
        <p className="text-[13px]" style={{ color: '#8a8a8a' }}>No events yet.</p>
      ) : (
        <div className="rounded-[12px] border overflow-hidden" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="grid grid-cols-[1fr_110px_90px_80px_80px_90px] gap-2 px-4 py-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: '#8a8a8a', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span>Event</span><span>Date</span><span>Codes</span><span>Sent</span><span>Avg %</span><span>TT</span>
          </div>
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-[1fr_110px_90px_80px_80px_90px] gap-2 px-4 py-3 text-[13px] items-center" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <span className="truncate flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: CATEGORY_COLOR[r.category] || '#8a8a8a' }} />
                <Link href={`/admin/events/${r.id}`} className="truncate hover:underline">{r.title}</Link>
              </span>
              <span style={{ color: '#c8c8c8' }}>{fmtDate(r.eventDate)}</span>
              <span>{r.memberCodes.total}</span>
              <span style={{ color: r.memberCodes.pending > 0 ? '#fbbf24' : '#4ade80' }}>{r.memberCodes.sent}</span>
              <span>{r.memberCodes.avgDiscountPercent != null ? `${r.memberCodes.avgDiscountPercent}%` : '—'}</span>
              <span style={{ color: r.ttSeriesLinked ? '#4ade80' : '#6a6a6a' }}>{r.ttSeriesLinked ? 'linked' : '—'}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
