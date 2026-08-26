import Link from 'next/link';
import { formatGrantDate } from './format';

// One allocation, as a tappable row. Counts come straight from
// public.partner_grants(), which computes them with the same rule the capacity
// trigger enforces, so the number here is the number the database will accept.
function SlotLine({ label, used, total, detail }) {
  const remaining = Math.max(0, total - used);
  const full = used >= total;

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-semibold" style={{ color: full ? '#c08a8a' : '#f5f5f5' }}>
          {label}: {used} of {total} used
        </span>
        <span className="text-[12px]" style={{ color: full ? '#c08a8a' : '#7ac68b' }}>
          {full ? 'full' : `${remaining} left`}
        </span>
      </div>
      {detail && (
        <div className="text-[12px] mt-0.5" style={{ color: '#8a8a8a' }}>
          {detail}
        </div>
      )}
    </div>
  );
}

export default function GrantCard({ grant, past = false }) {
  const freeTotal = grant.free_slots ?? 0;
  const discountTotal = grant.discount_slots ?? 0;

  return (
    <Link
      href={`/portal/guest-list/${grant.id}`}
      className="block rounded-[16px] border p-5 sm:p-6 transition-colors hover:border-white/20"
      style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold tracking-[0.16em] mb-1.5" style={{ color: '#8a8a8a' }}>
            {formatGrantDate(grant.event_date)}
            {grant.event_time ? ` · ${grant.event_time}` : ''}
          </div>
          <h2
            className="text-[19px] sm:text-[21px] font-bold leading-[1.2] break-words"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {grant.event_title}
          </h2>
        </div>
        <span className="text-[18px] flex-shrink-0 mt-1" style={{ color: '#6a6a6a' }} aria-hidden="true">
          ›
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {freeTotal > 0 && <SlotLine label="Free" used={Number(grant.free_used) || 0} total={freeTotal} />}
        {/* The discount line is hidden entirely when none were allocated —
            "Discount: 0 of 0" reads like something is broken. */}
        {discountTotal > 0 && (
          <SlotLine
            label="Discount"
            used={Number(grant.discount_used) || 0}
            total={discountTotal}
            detail={grant.discount_detail}
          />
        )}
        {freeTotal === 0 && discountTotal === 0 && (
          <div className="text-[13px]" style={{ color: '#8a8a8a' }}>
            No spots allocated for this event yet.
          </div>
        )}
      </div>

      {past && (
        <div className="mt-3 text-[11px] font-semibold tracking-[0.14em]" style={{ color: '#6a6a6a' }}>
          PAST EVENT
        </div>
      )}
    </Link>
  );
}
