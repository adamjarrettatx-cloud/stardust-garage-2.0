import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { adminPageGate } from '@/lib/auth-helpers';
import {
  buildEventPerformance,
  summarizePerformanceTotals,
  centsToUsd,
} from '@/lib/event-analytics';
import RefreshMetricsButton from './RefreshMetricsButton';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

const CATEGORY_COLOR = {
  workshop: '#ffb84d', yoga: '#4ade80', party: '#f472b6', other: '#8a8a8a',
};

function fmtDate(s) {
  if (!s) return '—';
  return new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtFetched(iso) {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
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

  // Cached TicketTailor metrics (populated by the read-only refresh route). The
  // table may not exist yet in a given environment — degrade gracefully to an
  // empty set so the page still renders local member-code data.
  let metrics = [];
  const metricsRes = await supabase
    .from('event_ticket_metrics')
    .select('event_id, tt_event_series_id, tickets_sold, orders_count, gross_cents, fees_cents, net_cents, attendees_count, checkins_count, source, status, fetched_at')
    .limit(5000);
  if (!metricsRes.error && metricsRes.data) metrics = metricsRes.data;

  const rows = buildEventPerformance({ events: events || [], codes: codes || [], metrics });
  const totals = summarizePerformanceTotals(rows);

  const lastFetched = metrics
    .map((m) => m.fetched_at)
    .filter(Boolean)
    .sort()
    .pop() || null;

  const hasAnyMetrics = totals.eventsWithMetrics > 0;

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
      <p className="mb-6 text-[14px]" style={{ color: '#8a8a8a' }}>
        Member-code engagement from local data plus cached TicketTailor sales metrics. Revenue figures come
        from the read-only metrics cache, refreshed on a daily cron or on demand below.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <RefreshMetricsButton />
        <span className="text-[12px]" style={{ color: '#8a8a8a' }}>
          Metrics last fetched: <span style={{ color: '#c8c8c8' }}>{fmtFetched(lastFetched)}</span>
        </span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Events', value: totals.events },
          { label: 'TT-linked events', value: totals.ttLinked },
          { label: 'Member codes', value: totals.memberCodes },
          { label: 'Codes sent', value: totals.codesSent },
        ].map((c) => (
          <div key={c.label} className="rounded-[14px] border p-5" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}>
            <div className="text-[10px] font-semibold tracking-[0.14em] uppercase mb-1.5" style={{ color: '#8a8a8a' }}>{c.label}</div>
            <div className="text-[28px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Revenue cards — only meaningful once metrics are cached. */}
      {hasAnyMetrics ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {[
            { label: 'Gross revenue', value: centsToUsd(totals.grossCents) },
            { label: 'Fees', value: centsToUsd(totals.feesCents) },
            { label: 'Net revenue', value: centsToUsd(totals.netCents) },
            { label: 'Tickets sold', value: totals.ticketsSold },
          ].map((c) => (
            <div key={c.label} className="rounded-[14px] border p-5" style={{ background: '#0f1a12', borderColor: 'rgba(74,222,128,0.22)' }}>
              <div className="text-[10px] font-semibold tracking-[0.14em] uppercase mb-1.5" style={{ color: '#4ade80' }}>{c.label}</div>
              <div className="text-[24px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{c.value}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[14px] border p-5 mb-10" style={{ background: '#16140d', borderColor: 'rgba(255,184,77,0.25)' }}>
          <div className="text-[10px] font-semibold tracking-[0.14em] uppercase mb-2" style={{ color: '#ffb84d' }}>
            No cached TicketTailor metrics yet
          </div>
          <p className="text-[13px]" style={{ color: '#c8c8c8' }}>
            Revenue, fees, net, and tickets-sold totals appear here once the read-only metrics cache is
            populated. Link an event to a TicketTailor series and click <strong>Refresh metrics</strong>, or
            wait for the daily cron. Events without a TT series, or environments without
            <code className="mx-1" style={{ color: 'white' }}>TICKETTAILOR_API_KEY</code>, are recorded as
            “not configured” rather than guessed.
          </p>
        </div>
      )}

      {/* Per-event table */}
      <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase mb-3" style={{ color: '#8a8a8a' }}>
        Performance by event
      </h2>
      {rows.length === 0 ? (
        <p className="text-[13px]" style={{ color: '#8a8a8a' }}>No events yet.</p>
      ) : (
        <div className="rounded-[12px] border overflow-hidden" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="grid grid-cols-[1fr_100px_90px_90px_70px_70px_80px] gap-2 px-4 py-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: '#8a8a8a', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span>Event</span><span>Date</span><span>Gross</span><span>Net</span><span>Sold</span><span>Codes</span><span>TT</span>
          </div>
          {rows.map((r) => {
            const m = r.metrics;
            // A refreshed event shows real figures (incl. a genuine $0.00 / 0);
            // an un-refreshed or not_configured event shows "—".
            const refreshed = m && m.refreshed;
            return (
              <div key={r.id} className="grid grid-cols-[1fr_100px_90px_90px_70px_70px_80px] gap-2 px-4 py-3 text-[13px] items-center" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <span className="truncate flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: CATEGORY_COLOR[r.category] || '#8a8a8a' }} />
                  <Link href={`/admin/events/${r.id}`} className="truncate hover:underline">{r.title}</Link>
                </span>
                <span style={{ color: '#c8c8c8' }}>{fmtDate(r.eventDate)}</span>
                <span style={{ color: refreshed ? '#e8e8e8' : '#6a6a6a' }}>{refreshed ? centsToUsd(m.grossCents) : '—'}</span>
                <span style={{ color: refreshed ? '#4ade80' : '#6a6a6a' }}>{refreshed ? centsToUsd(m.netCents) : '—'}</span>
                <span style={{ color: refreshed ? '#e8e8e8' : '#6a6a6a' }}>{refreshed ? m.ticketsSold : '—'}</span>
                <span title={`${r.memberCodes.sent} sent / ${r.memberCodes.total} total`}>
                  {r.memberCodes.sent}/{r.memberCodes.total}
                </span>
                <span style={{ color: r.ttSeriesLinked ? '#4ade80' : '#6a6a6a' }}>{r.ttSeriesLinked ? 'linked' : '—'}</span>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-[12px]" style={{ color: '#6a6a6a' }}>
        Codes column shows member discount codes sent / generated for the event. Revenue columns are blank
        until the event is TT-linked and its metrics have been refreshed.
      </p>
    </main>
  );
}
