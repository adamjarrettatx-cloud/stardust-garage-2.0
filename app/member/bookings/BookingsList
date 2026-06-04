'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  formatHour,
  formatMoney,
  formatDateDisplay,
  isCancellable,
} from '@/lib/studio-helpers';

function BookingCard({ booking, canCancel, onCancel, working }) {
  const isCancelled = booking.status === 'cancelled';
  return (
    <div
      className="rounded-[14px] border p-5 mb-3"
      style={{
        background: '#141414',
        borderColor: 'rgba(255,255,255,0.06)',
        opacity: isCancelled ? 0.5 : 1,
      }}
    >
      <div className="flex justify-between items-start mb-2">
        <div>
          <div
            className="text-[15px] font-bold"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {formatDateDisplay(booking.booking_date)}
          </div>
          <div className="text-[13px] mt-1" style={{ color: '#a0a0a0' }}>
            {formatHour(booking.start_hour)} – {formatHour(booking.end_hour)} ·{' '}
            {formatMoney(booking.total_cost_cents)}
          </div>
        </div>
        <div
          className="text-[10px] font-semibold tracking-[0.14em] px-2.5 py-1 rounded-full"
          style={{
            background: isCancelled
              ? 'rgba(255,80,80,0.15)'
              : 'rgba(80,200,120,0.15)',
            color: isCancelled ? '#ff8080' : '#80c878',
          }}
        >
          {isCancelled ? 'CANCELLED' : 'CONFIRMED'}
        </div>
      </div>

      {booking.notes && (
        <p className="text-[13px] mt-3" style={{ color: '#8a8a8a' }}>
          {booking.notes}
        </p>
      )}

      {canCancel && !isCancelled && (
        <button
          type="button"
          onClick={() => onCancel(booking.id)}
          disabled={working}
          className="mt-4 px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors hover:bg-red-500/10 hover:border-red-500/40 disabled:opacity-50"
          style={{
            borderColor: 'rgba(255,255,255,0.15)',
            color: '#f5f5f5',
          }}
        >
          CANCEL BOOKING
        </button>
      )}
    </div>
  );
}

export default function BookingsList({ upcoming, past, minAdvanceHours }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);

  async function handleCancel(bookingId) {
    const confirmed = window.confirm(
      'Cancel this booking? This cannot be undone.'
    );
    if (!confirmed) return;

    setWorking(true);
    try {
      const res = await fetch('/api/studio/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: bookingId }),
      });
      const body = await res.json();
      if (!res.ok) {
        alert('Error: ' + (body?.error || 'Failed to cancel'));
        setWorking(false);
        return;
      }
      router.refresh();
    } catch (err) {
      alert('Error: ' + (err?.message || 'Unknown'));
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      {/* Upcoming */}
      <div className="mb-12">
        <div
          className="text-[11px] font-semibold tracking-[0.18em] mb-4"
          style={{ color: '#8a8a8a' }}
        >
          UPCOMING ({upcoming.length})
        </div>
        {upcoming.length === 0 ? (
          <div
            className="rounded-[14px] border p-10 text-center"
            style={{
              background: '#141414',
              borderColor: 'rgba(255,255,255,0.06)',
            }}
          >
            <p className="mb-5" style={{ color: '#8a8a8a' }}>
              No upcoming bookings yet.
            </p>
            <Link
              href="/member/studio"
              className="inline-block px-6 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5"
              style={{ background: '#ffffff', color: '#0a0a0a' }}
            >
              BOOK STUDIO TIME
            </Link>
          </div>
        ) : (
          upcoming.map((b) => (
            <BookingCard
              key={b.id}
              booking={b}
              canCancel={isCancellable(b, minAdvanceHours)}
              onCancel={handleCancel}
              working={working}
            />
          ))
        )}
      </div>

      {/* Past */}
      {past.length > 0 && (
        <div>
          <div
            className="text-[11px] font-semibold tracking-[0.18em] mb-4"
            style={{ color: '#8a8a8a' }}
          >
            PAST & CANCELLED ({past.length})
          </div>
          {past.map((b) => (
            <BookingCard
              key={b.id}
              booking={b}
              canCancel={false}
              onCancel={handleCancel}
              working={working}
            />
          ))}
        </div>
      )}
    </>
  );
}
