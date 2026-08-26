'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFetch } from '@/lib/admin-fetch';
import {
  PAY_TYPE_OPTIONS,
  bookingStatusLabel,
  bookingPayInProgress,
  formatBookingAmount,
  formatSlotRange,
  toDatetimeLocalValue,
} from '@/lib/booking-helpers';
import { CONTRACTOR_CONTACT_TYPES } from '@/lib/contact-helpers';
import ContactSelect from '../../components/ContactSelect';

const labelClass = 'block text-[11px] font-semibold tracking-[0.14em] mb-2';
const labelStyle = { color: 'var(--auth-muted)' };
const inputClass =
  'w-full px-4 py-3 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30';
const inputStyle = {
  background: 'var(--auth-input-bg)',
  borderColor: 'var(--auth-input-border)',
  color: 'var(--auth-input-text)',
};

const EMPTY_FORM = {
  slot_start: '',
  slot_end: '',
  pay_type: 'hourly',
  hourly_rate: '',
  flat_amount: '',
};

function Badge({ children, color, bg, border }) {
  return (
    <span
      className="inline-block text-[10px] font-semibold tracking-[0.14em] px-2.5 py-1 rounded-full"
      style={{ color, background: bg, border: `1px solid ${border}` }}
    >
      {children}
    </span>
  );
}

// Same three-state read as GuestListPanel's PartnerState — an admin should
// know up front whether Phase 3's "Request Pay" button has anyone behind it.
function PartnerState({ booking }) {
  if (booking.partner?.is_active) {
    return (
      <Badge color="var(--auth-success)" bg="var(--auth-success-bg)" border="var(--auth-success-border)">
        PARTNER ACTIVE
      </Badge>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge color="var(--auth-warn)" bg="var(--auth-warn-bg)" border="var(--auth-warn-border)">
        {booking.partner ? 'INVITE PENDING' : 'NO PORTAL LOGIN'}
      </Badge>
      <span className="text-[11px]" style={{ color: 'var(--auth-warn-strong)' }}>
        {booking.partner
          ? 'They can’t request pay until they finish activating.'
          : 'They can’t request pay until they’re invited and activate.'}{' '}
        <Link href={`/bananas/contacts/${booking.contact_id}`} className="underline">
          Open contact
        </Link>
      </span>
    </div>
  );
}

function statusBadgeColors(status) {
  if (status === 'paid' || status === 'approved') return { color: 'var(--auth-success)', bg: 'var(--auth-success-bg)', border: 'var(--auth-success-border)' };
  if (status === 'rejected') return { color: 'var(--auth-danger)', bg: 'var(--auth-danger-bg)', border: 'var(--auth-danger-border)' };
  if (status === 'cancelled') return { color: 'var(--auth-muted)', bg: 'var(--auth-card-bg-alt)', border: 'var(--auth-card-border)' };
  if (status === 'pay_requested' || status === 'in_review') return { color: 'var(--auth-warn)', bg: 'var(--auth-warn-bg)', border: 'var(--auth-warn-border)' };
  return { color: 'var(--auth-violet-strong)', bg: 'var(--auth-card-bg-alt)', border: 'var(--auth-card-border)' };
}

// Slot times + pay type/rate. Shared by "add artist" and "edit booking" so
// both submit the same shape the API route validates with buildBookingPayload.
function BookingForm({ form, setForm, busy, error, onSubmit, onCancel, submitLabel }) {
  const field = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} style={labelStyle}>
            SLOT START
          </label>
          <input
            type="datetime-local"
            value={form.slot_start}
            onChange={field('slot_start')}
            required
            className={inputClass}
            style={inputStyle}
          />
        </div>
        <div>
          <label className={labelClass} style={labelStyle}>
            SLOT END
          </label>
          <input
            type="datetime-local"
            value={form.slot_end}
            onChange={field('slot_end')}
            required
            className={inputClass}
            style={inputStyle}
          />
        </div>
      </div>

      <div>
        <label className={labelClass} style={labelStyle}>
          PAY TYPE
        </label>
        <div className="flex gap-2">
          {PAY_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setForm({ ...form, pay_type: opt.value })}
              className="px-5 py-2.5 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors"
              style={
                form.pay_type === opt.value
                  ? { background: 'var(--auth-text-strong)', color: 'var(--auth-strong-surface-text)', borderColor: 'var(--auth-text-strong)' }
                  : { borderColor: 'var(--auth-card-border-strong)', color: 'var(--auth-text)' }
              }
            >
              {opt.label.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {form.pay_type === 'hourly' ? (
        <div>
          <label className={labelClass} style={labelStyle}>
            HOURLY RATE ($)
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={form.hourly_rate}
            onChange={field('hourly_rate')}
            required
            className={inputClass}
            style={inputStyle}
          />
        </div>
      ) : (
        <div>
          <label className={labelClass} style={labelStyle}>
            FLAT AMOUNT ($)
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={form.flat_amount}
            onChange={field('flat_amount')}
            required
            className={inputClass}
            style={inputStyle}
          />
        </div>
      )}

      {error && (
        <p className="text-[13px]" style={{ color: 'var(--auth-danger)' }}>
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={busy}
          className="px-6 py-3 rounded-full text-[11px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5 disabled:opacity-40"
          style={{ background: 'var(--auth-text-strong)', color: 'var(--auth-strong-surface-text)' }}
        >
          {busy ? 'SAVING…' : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-6 py-3 rounded-full text-[11px] font-semibold tracking-[0.14em] border transition-colors hover:bg-white/5 disabled:opacity-40"
          style={{ borderColor: 'var(--auth-card-border-strong)', color: 'var(--auth-text)' }}
        >
          CANCEL
        </button>
      </div>
    </form>
  );
}

// Per-event artist lineup: who's playing, their slot, and their pay rate.
// Every write goes through /api/admin/events/:id/bookings so the
// contractor-type check and the booking_audit_log row happen server-side;
// each response hands back the refreshed booking list, mirroring
// GuestListPanel's applyGrants pattern.
export default function ArtistLineupPanel({ eventId }) {
  const [bookings, setBookings] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [addForm, setAddForm] = useState(null);
  const [addContactId, setAddContactId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState({});

  const load = useCallback(async () => {
    try {
      const res = await adminFetch(`/api/admin/events/${eventId}/bookings`);
      setBookings(res.bookings || []);
      setLoadError('');
    } catch (err) {
      setLoadError(err?.message || 'Could not load the artist lineup');
    }
  }, [eventId]);

  const applyBookings = useCallback(
    async (res) => {
      if (res?.bookings) setBookings(res.bookings);
      else await load();
    },
    [load]
  );

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    setAddContactId(null);
    setAddForm({ ...EMPTY_FORM });
    setEditing(null);
    setFormError('');
  };

  const openEdit = (booking) => {
    setEditing({
      id: booking.id,
      form: {
        slot_start: toDatetimeLocalValue(booking.slot_start),
        slot_end: toDatetimeLocalValue(booking.slot_end),
        pay_type: booking.pay_type,
        hourly_rate: booking.hourly_rate_cents ? String(booking.hourly_rate_cents / 100) : '',
        flat_amount: booking.flat_amount_cents ? String(booking.flat_amount_cents / 100) : '',
      },
    });
    setAddForm(null);
    setFormError('');
  };

  async function submitForm(url, method, form) {
    setBusy(true);
    setFormError('');
    try {
      const res = await adminFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      await applyBookings(res);
      setAddForm(null);
      setEditing(null);
    } catch (err) {
      setFormError(err?.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  const handleAdd = (e) => {
    e.preventDefault();
    if (!addContactId) {
      setFormError('Select an artist to add to the lineup.');
      return;
    }
    submitForm(`/api/admin/events/${eventId}/bookings`, 'POST', {
      ...addForm,
      contactId: addContactId,
    });
  };

  const handleEdit = (e) => {
    e.preventDefault();
    submitForm(`/api/admin/events/${eventId}/bookings/${editing.id}`, 'PATCH', editing.form);
  };

  const handleRemove = async (booking) => {
    const name = booking.contact?.display_name || 'this artist';
    if (!window.confirm(`Remove ${name} from the lineup? This cannot be undone.`)) return;

    setRowError((prev) => ({ ...prev, [booking.id]: '' }));
    setBusy(true);
    try {
      const res = await adminFetch(`/api/admin/events/${eventId}/bookings/${booking.id}`, {
        method: 'DELETE',
      });
      await applyBookings(res);
    } catch (err) {
      setRowError((prev) => ({ ...prev, [booking.id]: err?.message || 'Could not remove the booking' }));
    } finally {
      setBusy(false);
    }
  };

  // Phase 3: admin-only "Reopen for Payment" — the only way a rejected
  // booking becomes requestable again. Reuses adminFetch's error surface but
  // hits a booking-level route, not the bookings CRUD route, so it refreshes
  // by reloading the lineup rather than trusting a bookings[] echo back.
  const handleReopen = async (booking) => {
    setRowError((prev) => ({ ...prev, [booking.id]: '' }));
    setBusy(true);
    try {
      await adminFetch(`/api/admin/bookings/${booking.id}/reopen`, { method: 'POST' });
      await load();
    } catch (err) {
      setRowError((prev) => ({ ...prev, [booking.id]: err?.message || 'Could not reopen this booking' }));
    } finally {
      setBusy(false);
    }
  };

  const bookedContactIds = (bookings || []).map((b) => b.contact_id);

  return (
    <section
      className="rounded-[12px] border p-5 mt-8"
      style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h2 className="text-[12px] font-semibold tracking-[0.14em]" style={{ color: 'var(--auth-muted)' }}>
          ARTIST LINEUP
        </h2>
        {!addForm && (
          <button
            type="button"
            onClick={openAdd}
            className="px-5 py-2.5 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors hover:bg-white/5"
            style={{ borderColor: 'var(--auth-card-border-strong)', color: 'var(--auth-text)' }}
          >
            ADD ARTIST
          </button>
        )}
      </div>
      <p className="text-[12px] mb-5" style={{ color: 'var(--auth-muted)' }}>
        Who&rsquo;s playing this event, their time slot, and what they&rsquo;re owed. A booking can no longer be
        edited or removed once a pay request is in progress for it.
      </p>

      {addForm && (
        <div
          className="rounded-[10px] border p-4 mb-5"
          style={{ background: 'var(--auth-card-bg-alt)', borderColor: 'var(--auth-card-border)' }}
        >
          <div className="mb-4">
            <label className={labelClass} style={labelStyle}>
              ARTIST
            </label>
            <ContactSelect
              value={addContactId}
              onChange={setAddContactId}
              excludeIds={bookedContactIds}
              contactTypeIn={CONTRACTOR_CONTACT_TYPES}
              hint="Only DJ / artist / performer contacts show here. Contacts already in this lineup are hidden — edit their booking instead."
            />
          </div>
          <BookingForm
            form={addForm}
            setForm={setAddForm}
            busy={busy}
            error={formError}
            onSubmit={handleAdd}
            onCancel={() => setAddForm(null)}
            submitLabel="ADD TO LINEUP"
          />
        </div>
      )}

      {loadError && (
        <p className="text-[13px]" style={{ color: 'var(--auth-danger)' }}>
          {loadError}
        </p>
      )}

      {!loadError && bookings === null && (
        <p className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
          Loading lineup…
        </p>
      )}

      {bookings?.length === 0 && (
        <p className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
          No artists booked for this event yet.
        </p>
      )}

      <div className="space-y-3">
        {(bookings || []).map((booking) => {
          const isEditing = editing?.id === booking.id;
          const locked = bookingPayInProgress(booking.status);
          const statusColors = statusBadgeColors(booking.status);
          return (
            <div
              key={booking.id}
              className="rounded-[10px] border p-4"
              style={{ background: 'var(--auth-card-bg-alt)', borderColor: 'var(--auth-card-border)' }}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/bananas/contacts/${booking.contact_id}`}
                      className="text-[15px] font-bold hover:underline"
                      style={{ color: 'var(--auth-text-strong)' }}
                    >
                      {booking.contact?.display_name || 'Unknown contact'}
                    </Link>
                    <Badge color={statusColors.color} bg={statusColors.bg} border={statusColors.border}>
                      {bookingStatusLabel(booking.status).toUpperCase()}
                    </Badge>
                  </div>
                  {booking.contact?.company && (
                    <span className="text-[12px]" style={{ color: 'var(--auth-muted)' }}>
                      {booking.contact.company}
                    </span>
                  )}
                  <div className="text-[13px] mt-1" style={{ color: 'var(--auth-text)' }}>
                    {formatSlotRange(booking.slot_start, booking.slot_end)}
                  </div>
                  <div className="text-[13px] mt-1" style={{ color: 'var(--auth-muted-strong)' }}>
                    {formatBookingAmount(booking)}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => (isEditing ? setEditing(null) : openEdit(booking))}
                    disabled={!isEditing && locked}
                    className="px-4 py-2 rounded-full text-[10px] font-semibold tracking-[0.12em] border transition-colors hover:bg-white/5 disabled:opacity-40"
                    style={{ borderColor: 'var(--auth-card-border-strong)', color: 'var(--auth-text)' }}
                  >
                    {isEditing ? 'CLOSE' : 'EDIT'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(booking)}
                    disabled={busy || locked}
                    className="px-4 py-2 rounded-full text-[10px] font-semibold tracking-[0.12em] border transition-colors disabled:opacity-40"
                    style={{ borderColor: 'var(--auth-danger-border)', color: 'var(--auth-danger)' }}
                  >
                    REMOVE
                  </button>
                </div>
              </div>

              <div className="mt-3">
                <PartnerState booking={booking} />
              </div>

              {/* Phase 3 pay-status actions. pay_requested/approved link into the
                  Review & Pay screen; rejected surfaces the admin-only reopen
                  action right where the rejection is visible, instead of
                  making an admin hunt for it in a separate list. */}
              {(booking.status === 'pay_requested' || booking.status === 'approved') && (
                <div className="mt-3">
                  <Link
                    href="/bananas/pay-requests"
                    className="text-[12px] font-semibold underline"
                    style={{ color: 'var(--auth-text)' }}
                  >
                    Review &amp; Pay →
                  </Link>
                </div>
              )}
              {booking.status === 'rejected' && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => handleReopen(booking)}
                    disabled={busy}
                    className="px-4 py-2 rounded-full text-[10px] font-semibold tracking-[0.12em] border transition-colors hover:bg-white/5 disabled:opacity-40"
                    style={{ borderColor: 'var(--auth-card-border-strong)', color: 'var(--auth-text)' }}
                  >
                    REOPEN FOR PAYMENT
                  </button>
                </div>
              )}

              {rowError[booking.id] && (
                <p className="text-[12px] mt-3" style={{ color: 'var(--auth-danger)' }}>
                  {rowError[booking.id]}
                </p>
              )}

              {isEditing && (
                <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--auth-row-border)' }}>
                  <BookingForm
                    form={editing.form}
                    setForm={(form) => setEditing({ ...editing, form })}
                    busy={busy}
                    error={formError}
                    onSubmit={handleEdit}
                    onCancel={() => setEditing(null)}
                    submitLabel="SAVE CHANGES"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
