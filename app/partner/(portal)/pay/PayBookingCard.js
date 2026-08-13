'use client';

import { useState } from 'react';
import { formatGrantDate } from '../guest-list/format';
import { partnerBookingState, minutesUntilPayRequestEligible, formatMoney } from '@/lib/pay-request-helpers';
import { formatSlotRange } from '@/lib/booking-helpers';

const STATE_BADGE = {
  pending_review: { label: 'Pending review', color: '#e0c26a', bg: 'rgba(224,194,106,0.12)' },
  approved: { label: 'Approved — cleared to pay', color: '#7ac68b', bg: 'rgba(122,198,139,0.12)' },
  rejected: { label: 'Rejected', color: '#c08a8a', bg: 'rgba(192,138,138,0.12)' },
  cancelled: { label: 'Cancelled', color: '#8a8a8a', bg: 'rgba(255,255,255,0.06)' },
};

export default function PayBookingCard({ booking }) {
  const [state, setState] = useState(booking);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const bookingState = partnerBookingState(state);
  const minutesLeft = minutesUntilPayRequestEligible(state.slot_end);

  const handleRequest = async () => {
    setSubmitting(true);
    setError('');
    const res = await fetch(`/api/partner/bookings/${state.id}/request-pay`, { method: 'POST' });
    const data = await res.json().catch(() => null);
    setSubmitting(false);

    if (!res.ok) {
      setError(data?.error || 'Could not send that request.');
      return;
    }

    const refreshed = (data.bookings || []).find((b) => b.id === state.id);
    if (refreshed) setState(refreshed);
  };

  return (
    <div className="rounded-[16px] border p-5 sm:p-6" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold tracking-[0.16em] mb-1.5" style={{ color: '#8a8a8a' }}>
            {formatGrantDate(state.event_date)}
            {state.event_time ? ` · ${state.event_time}` : ''}
          </div>
          <h2 className="text-[19px] sm:text-[21px] font-bold leading-[1.2] break-words" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {state.event_title}
          </h2>
          <div className="text-[13px] mt-1" style={{ color: '#a0a0a0' }}>
            {formatSlotRange(state.slot_start, state.slot_end)}
          </div>
        </div>
        <div className="text-[20px] font-bold flex-shrink-0" style={{ color: '#f5f5f5' }}>
          {formatMoney(state.amount_cents)}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        {bookingState === 'can_request' && (
          <button
            type="button"
            onClick={handleRequest}
            disabled={submitting}
            className="px-6 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5 disabled:opacity-40"
            style={{ background: '#ffffff', color: '#0a0a0a' }}
          >
            {submitting ? 'SENDING…' : 'REQUEST PAY'}
          </button>
        )}

        {bookingState === 'not_yet' && (
          <p className="text-[13px]" style={{ color: '#6a6a6a' }}>
            Request Pay unlocks in {minutesLeft} min — 15 minutes after your set ends.
          </p>
        )}

        {STATE_BADGE[bookingState] && (
          <div>
            <span
              className="inline-block text-[11px] font-semibold tracking-[0.12em] px-3 py-1.5 rounded-full"
              style={{ color: STATE_BADGE[bookingState].color, background: STATE_BADGE[bookingState].bg }}
            >
              {STATE_BADGE[bookingState].label.toUpperCase()}
            </span>
            {bookingState === 'rejected' && state.rejection_reason && (
              <p className="text-[13px] mt-2" style={{ color: '#a0a0a0' }}>
                {state.rejection_reason}
              </p>
            )}
            {bookingState === 'rejected' && (
              <p className="text-[12px] mt-2" style={{ color: '#6a6a6a' }}>
                Reach out if you think this was a mistake — an admin can reopen it for you.
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="text-[13px] mt-3" style={{ color: '#c08a8a' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
