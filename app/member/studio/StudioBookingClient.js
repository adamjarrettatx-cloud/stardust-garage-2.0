'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  formatHour,
  formatMoney,
  formatDateDisplay,
  getUpcomingDates,
  computeHourStatus,
} from '@/lib/studio-helpers';

export default function StudioBookingClient({ settings, existingBookings }) {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(null);
  const [startHour, setStartHour] = useState(null);
  const [endHour, setEndHour] = useState(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);

  // Generate the next 30 days for the date strip
  const dates = useMemo(
    () => getUpcomingDates(30, settings.open_days),
    [settings.open_days]
  );

  // For the selected date, figure out which hours are available
  const hourStatus = useMemo(() => {
    if (!selectedDate) return null;
    const dateBookings = existingBookings.filter(
      (b) => b.booking_date === selectedDate
    );
    return computeHourStatus({
      openHour: settings.open_hour,
      closeHour: settings.close_hour,
      minAdvanceHours: settings.min_advance_hours,
      bookings: dateBookings,
      date: selectedDate,
    });
  }, [selectedDate, existingBookings, settings]);

  const length = startHour !== null && endHour !== null ? endHour - startHour : 0;
  const totalCents = length * settings.hourly_rate_cents;

  // Validation: can we submit?
  const canSubmit =
    selectedDate &&
    startHour !== null &&
    endHour !== null &&
    length >= settings.min_booking_hours;

  function handleSelectDate(date) {
    setSelectedDate(date);
    setStartHour(null);
    setEndHour(null);
    setError('');
  }

  function handleSelectStartHour(h) {
    setStartHour(h);
    // If endHour is before new start or unset, reset it
    if (endHour === null || endHour <= h) {
      setEndHour(h + settings.min_booking_hours);
    }
  }

  function handleSelectEndHour(h) {
    setEndHour(h);
  }

  async function handleSubmit() {
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/studio/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_date: selectedDate,
          start_hour: startHour,
          end_hour: endHour,
          notes: notes,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || 'Booking failed.');
        setSubmitting(false);
        return;
      }
      setSuccess(body.booking);
      setSubmitting(false);
    } catch (err) {
      setError(err?.message || 'Booking failed.');
      setSubmitting(false);
    }
  }

  // Success state — show confirmation
  if (success) {
    return (
      <main className="max-w-[700px] mx-auto px-6 py-16">
        <div
          className="rounded-[14px] border p-10 text-center"
          style={{
            background: 'var(--surface-1)',
            borderColor: 'var(--fg-a08)',
          }}
        >
          <div
            className="text-[11px] font-semibold tracking-[0.28em] mb-4"
            style={{ color: 'var(--text-3)' }}
          >
            BOOKING CONFIRMED
          </div>
          <h1
            className="text-[32px] font-extrabold -tracking-[0.02em] leading-[1.15] mb-6"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            You&apos;re booked.
          </h1>
          <div
            className="text-[15px] leading-[1.7] mb-6"
            style={{ color: 'var(--text-3)' }}
          >
            <div>{formatDateDisplay(success.booking_date)}</div>
            <div>
              {formatHour(success.start_hour)} – {formatHour(success.end_hour)}
            </div>
            <div>{formatMoney(success.total_cost_cents)} total</div>
          </div>
          <p
            className="text-[12px] mb-8"
            style={{ color: 'var(--fg-a4)' }}
          >
            Payment will be set up in a future update. For now, your booking is reserved.
          </p>
          <div className="flex gap-3 justify-center">
            <Link
              href="/member/bookings"
              className="px-6 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5"
              style={{ background: '#ffffff', color: '#0a0a0a' }}
            >
              MY BOOKINGS
            </Link>
            <Link
              href="/member"
              className="px-6 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.14em] border transition-colors hover:bg-white/5"
              style={{ borderColor: 'var(--fg-a15)', color: 'var(--text-1)' }}
            >
              MEMBER HOME
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-[900px] mx-auto px-6 py-16">
      <div className="mb-10">
        <Link
          href="/member"
          className="text-[12px] tracking-[0.14em] mb-4 inline-block hover:text-white transition-colors"
          style={{ color: 'var(--text-3)' }}
        >
          ← BACK TO MEMBER HOME
        </Link>
        <div
          className="text-[11px] font-semibold tracking-[0.28em] mb-3"
          style={{ color: 'var(--fg-a5)' }}
        >
          BOOK STUDIO TIME
        </div>
        <h1
          className="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-3"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          Reserve the studio.
        </h1>
        <p className="text-[14px]" style={{ color: 'var(--text-3)' }}>
          {formatMoney(settings.hourly_rate_cents)} per hour · minimum{' '}
          {settings.min_booking_hours} hours · at least {settings.min_advance_hours}-hour advance notice
        </p>
      </div>

      {/* Date strip */}
      <div className="mb-8">
        <div
          className="text-[11px] font-semibold tracking-[0.18em] mb-3"
          style={{ color: 'var(--text-3)' }}
        >
          1. CHOOSE A DATE
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-2 px-2">
          {dates.map((d) => {
            const isSelected = selectedDate === d.date;
            const isDisabled = !d.isBookable;
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => !isDisabled && handleSelectDate(d.date)}
                disabled={isDisabled}
                className="flex-shrink-0 px-3 py-3 rounded-[10px] border transition-all min-w-[68px]"
                style={{
                  background: isSelected ? '#ffffff' : 'var(--surface-1)',
                  color: isSelected ? '#0a0a0a' : isDisabled ? 'var(--surface-5)' : 'var(--text-1)',
                  borderColor: isSelected
                    ? '#ffffff'
                    : isDisabled
                      ? 'rgba(255,255,255,0.03)'
                      : 'rgba(255,255,255,0.08)',
                  opacity: isDisabled ? 0.4 : 1,
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                }}
              >
                <div
                  className="text-[10px] font-semibold tracking-[0.14em] mb-0.5"
                  style={{
                    color: isSelected ? '#0a0a0a' : isDisabled ? 'var(--surface-5)' : 'var(--text-3)',
                  }}
                >
                  {d.label}
                </div>
                <div className="text-[18px] font-bold leading-none">
                  {d.dayNum}
                </div>
                <div
                  className="text-[10px] tracking-[0.08em] mt-1"
                  style={{
                    color: isSelected ? '#0a0a0a' : isDisabled ? 'var(--surface-5)' : 'var(--text-3)',
                  }}
                >
                  {d.month}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Hour selection */}
      {selectedDate && hourStatus && (
        <div className="mb-8">
          <div
            className="text-[11px] font-semibold tracking-[0.18em] mb-3"
            style={{ color: 'var(--text-3)' }}
          >
            2. PICK YOUR HOURS
          </div>

          {/* Start hour */}
          <div className="mb-4">
            <div
              className="text-[11px] tracking-[0.1em] mb-2"
              style={{ color: 'var(--text-3)' }}
            >
              START
            </div>
            <div className="flex flex-wrap gap-2">
              {hourStatus.hours.slice(0, -1).map((h) => {
                const isBlocked =
                  hourStatus.blockedByExisting.has(h) ||
                  hourStatus.blockedByAdvance.has(h);
                const isSelected = startHour === h;
                return (
                  <button
                    key={h}
                    type="button"
                    onClick={() => !isBlocked && handleSelectStartHour(h)}
                    disabled={isBlocked}
                    className="px-3 py-2 rounded-full text-[12px] font-semibold transition-all border"
                    style={{
                      background: isSelected ? '#ffffff' : 'transparent',
                      color: isSelected
                        ? '#0a0a0a'
                        : isBlocked
                          ? 'var(--surface-5)'
                          : 'var(--text-1)',
                      borderColor: isSelected
                        ? '#ffffff'
                        : isBlocked
                          ? 'rgba(255,255,255,0.04)'
                          : 'rgba(255,255,255,0.15)',
                      opacity: isBlocked ? 0.5 : 1,
                      textDecoration: isBlocked ? 'line-through' : 'none',
                      cursor: isBlocked ? 'not-allowed' : 'pointer',
                      minWidth: 64,
                    }}
                  >
                    {formatHour(h)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* End hour */}
          {startHour !== null && (
            <div className="mb-4">
              <div
                className="text-[11px] tracking-[0.1em] mb-2"
                style={{ color: 'var(--text-3)' }}
              >
                END
              </div>
              <div className="flex flex-wrap gap-2">
                {hourStatus.hours.slice(1).map((h) => {
                  // End hour must be > start hour
                  // Min booking length must be met
                  const meetsMin = h - startHour >= settings.min_booking_hours;
                  if (h <= startHour) return null;

                  // Check: any hour between start..h is blocked? Then this end is invalid
                  let conflicts = false;
                  for (let i = startHour; i < h; i++) {
                    if (
                      hourStatus.blockedByExisting.has(i) ||
                      hourStatus.blockedByAdvance.has(i)
                    ) {
                      conflicts = true;
                      break;
                    }
                  }

                  const isBlocked = conflicts || !meetsMin;
                  const isSelected = endHour === h;
                  return (
                    <button
                      key={h}
                      type="button"
                      onClick={() => !isBlocked && handleSelectEndHour(h)}
                      disabled={isBlocked}
                      className="px-3 py-2 rounded-full text-[12px] font-semibold transition-all border"
                      style={{
                        background: isSelected ? '#ffffff' : 'transparent',
                        color: isSelected
                          ? '#0a0a0a'
                          : isBlocked
                            ? 'var(--surface-5)'
                            : 'var(--text-1)',
                        borderColor: isSelected
                          ? '#ffffff'
                          : isBlocked
                            ? 'rgba(255,255,255,0.04)'
                            : 'rgba(255,255,255,0.15)',
                        opacity: isBlocked ? 0.5 : 1,
                        cursor: isBlocked ? 'not-allowed' : 'pointer',
                        minWidth: 64,
                      }}
                    >
                      {formatHour(h)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Notes */}
      {canSubmit && (
        <div className="mb-8">
          <label
            className="block text-[11px] font-semibold tracking-[0.18em] mb-3"
            style={{ color: 'var(--text-3)' }}
          >
            3. NOTES (OPTIONAL)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything we should know for your session?"
            rows={3}
            className="w-full px-5 py-3.5 rounded-[14px] text-[14px] outline-none border transition-colors focus:border-white/30 resize-none"
            style={{
              background: 'var(--surface-1)',
              borderColor: 'var(--fg-a08)',
              color: 'var(--text-1)',
            }}
          />
        </div>
      )}

      {/* Summary + submit */}
      {canSubmit && (
        <div
          className="rounded-[14px] border p-6 mb-4"
          style={{ background: 'var(--surface-1)', borderColor: 'var(--fg-a08)' }}
        >
          <div className="flex justify-between items-baseline mb-2">
            <div className="text-[14px]" style={{ color: 'var(--text-3)' }}>
              {formatDateDisplay(selectedDate)}
            </div>
            <div className="text-[14px]" style={{ color: 'var(--text-1)' }}>
              {formatHour(startHour)} – {formatHour(endHour)}
            </div>
          </div>
          <div className="flex justify-between items-baseline pt-3 border-t" style={{ borderColor: 'var(--fg-a05)' }}>
            <div className="text-[14px]" style={{ color: 'var(--text-3)' }}>
              {length} hour{length === 1 ? '' : 's'} × {formatMoney(settings.hourly_rate_cents)}
            </div>
            <div
              className="text-[22px] font-extrabold"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              {formatMoney(totalCents)}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="text-[13px] text-red-400 mb-4">{error}</div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit || submitting}
        className="w-full py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ background: '#ffffff', color: '#0a0a0a' }}
      >
        {submitting ? 'BOOKING…' : 'CONFIRM BOOKING'}
      </button>

      <p
        className="text-[11px] text-center mt-4"
        style={{ color: 'var(--fg-a4)' }}
      >
        Payment will be added in a future update. For now your booking is reserved without charge.
      </p>
    </main>
  );
}
