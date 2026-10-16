'use client';

// Read-only record for the legacy events that sold through Ticket Tailor.
// Ticket Tailor is retired: the link can no longer be changed and sales are
// never re-pulled. The numbers shown are the frozen final snapshot.

function fmtFetched(iso) {
  if (!iso) return 'not recorded';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function TtLinkPanel({ initialSeriesId, metrics = null }) {
  return (
    <div className="rounded-[8px] border p-5" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-semibold tracking-[0.14em]" style={{ color: 'var(--auth-muted)' }}>
          TICKET TAILOR RECORD
        </span>
        <span
          className="text-[11px] font-semibold tracking-[0.12em] px-2.5 py-1 rounded-[6px]"
          style={{ color: 'var(--auth-muted)', background: 'var(--auth-row-border)' }}
        >
          FROZEN
        </span>
      </div>
      <p className="text-[13px]" style={{ color: 'var(--auth-text)' }}>
        Series {initialSeriesId || 'not recorded'}
        {metrics ? ` · ${Number(metrics.orders_count || 0)} orders` : ''}
        {' · final sync '}{fmtFetched(metrics?.fetched_at)}
      </p>
      <p className="text-[11px] mt-2" style={{ color: 'var(--auth-muted)' }}>
        Ticket Tailor is retired. These sales are kept as a permanent record and are no longer synced.
      </p>
    </div>
  );
}
