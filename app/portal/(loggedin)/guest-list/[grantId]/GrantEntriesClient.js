'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  MAX_GUEST_NAME_LENGTH,
  addableCompTypes,
  canRemoveEntry,
  compTypeLabel,
  entryStatusLabel,
  grantUsage,
  normalizeGuestName,
} from '@/lib/guestlist-helpers';
import { formatGrantDate } from '../format';

const STATUS_STYLES = {
  pending: { background: 'rgba(255,255,255,0.07)', color: '#a0a0a0' },
  checked_in: { background: 'rgba(122,198,139,0.14)', color: '#7ac68b' },
  no_show: { background: 'rgba(192,138,138,0.14)', color: '#c08a8a' },
};

function StatusBadge({ status }) {
  return (
    <span
      className="px-2.5 py-1 rounded-full text-[10px] font-semibold tracking-[0.12em] flex-shrink-0"
      style={STATUS_STYLES[status] || STATUS_STYLES.pending}
    >
      {entryStatusLabel(status).toUpperCase()}
    </span>
  );
}

// Slot accounting is recomputed from `entries` on every render rather than
// tracked separately, so adding or withdrawing a name updates the counts, the
// comp type choices and the disabled state from one source. It matches the
// server's arithmetic because both call grantUsage().
export default function GrantEntriesClient({ grant, initialEntries }) {
  const [entries, setEntries] = useState(initialEntries);
  const [guestName, setGuestName] = useState('');
  const [compType, setCompType] = useState(null);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [error, setError] = useState('');

  const usage = useMemo(() => grantUsage(grant, entries), [grant, entries]);
  const addable = useMemo(() => addableCompTypes(usage), [usage]);

  // The partner only chooses when both kinds are allocated AND both have room.
  // With one option there is nothing to decide, so the selector is hidden and
  // the remaining type is used.
  const showCompTypeChoice = addable.length > 1;
  const selectedCompType = showCompTypeChoice ? compType || addable[0] : addable[0] || null;
  const allocationFull = addable.length === 0;
  const anySlots = usage.free.allocated || usage.discount.allocated;

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');

    const name = normalizeGuestName(guestName);
    if (!name) {
      setError("Please enter your guest's name.");
      return;
    }
    if (!selectedCompType) {
      setError('There are no spots left on this event.');
      return;
    }

    setAdding(true);
    const res = await fetch('/api/portal/guestlist/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grantId: grant.id, guestName: name, compType: selectedCompType }),
    });
    const data = await res.json().catch(() => null);
    setAdding(false);

    if (!res.ok || !data?.entry) {
      setError(data?.error || 'Could not add that guest.');
      return;
    }

    setEntries((prev) => [...prev, data.entry]);
    // The comp type is deliberately kept: partners add guests in runs, and
    // re-picking "discount" for each of five names is friction for nothing. If
    // that type fills up, the selector collapses to whatever is left.
    setGuestName('');
  };

  const handleRemove = async (entry) => {
    setError('');
    setRemovingId(entry.id);

    const res = await fetch(`/api/portal/guestlist/entries/${entry.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => null);
    setRemovingId(null);

    if (!res.ok) {
      setError(data?.error || 'Could not remove that guest.');
      return;
    }
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
  };

  return (
    <main className="max-w-[720px] mx-auto px-5 sm:px-6 py-8 sm:py-12">
      <Link
        href="/portal/guest-list"
        className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-6 transition-colors hover:text-white"
        style={{ color: '#8a8a8a' }}
      >
        ‹ ALL EVENTS
      </Link>

      <div className="text-[11px] font-semibold tracking-[0.16em] mb-2" style={{ color: '#8a8a8a' }}>
        {formatGrantDate(grant.event_date)}
        {grant.event_time ? ` · ${grant.event_time}` : ''}
      </div>
      <h1
        className="text-[26px] sm:text-[34px] font-extrabold -tracking-[0.02em] leading-[1.12] mb-6 break-words"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        {grant.event_title}
      </h1>

      <div
        className="rounded-[16px] border p-5 sm:p-6 mb-6 space-y-3"
        style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}
      >
        {usage.free.allocated && (
          <div className="text-[14px]">
            <span style={{ color: '#f5f5f5' }}>
              Free: {usage.free.used} of {usage.free.total} used
            </span>
            <span className="ml-2 text-[12px]" style={{ color: usage.free.full ? '#c08a8a' : '#7ac68b' }}>
              {usage.free.full ? 'full' : `${usage.free.remaining} left`}
            </span>
          </div>
        )}
        {usage.discount.allocated && (
          <div className="text-[14px]">
            <div>
              <span style={{ color: '#f5f5f5' }}>
                Discount: {usage.discount.used} of {usage.discount.total} used
              </span>
              <span
                className="ml-2 text-[12px]"
                style={{ color: usage.discount.full ? '#c08a8a' : '#7ac68b' }}
              >
                {usage.discount.full ? 'full' : `${usage.discount.remaining} left`}
              </span>
            </div>
            {grant.discount_detail && (
              <div className="text-[12px] mt-1" style={{ color: '#8a8a8a' }}>
                {grant.discount_detail}
              </div>
            )}
          </div>
        )}
        {!anySlots && (
          <div className="text-[14px]" style={{ color: '#8a8a8a' }}>
            No spots have been allocated for this event yet.
          </div>
        )}
      </div>

      {anySlots && (
        <form
          onSubmit={handleAdd}
          className="rounded-[16px] border p-5 sm:p-6 mb-8"
          style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}
        >
          <div className="text-[12px] font-semibold tracking-[0.14em] mb-4" style={{ color: '#8a8a8a' }}>
            ADD A GUEST
          </div>

          {allocationFull ? (
            <p className="text-[14px] leading-[1.6]" style={{ color: '#c08a8a' }}>
              {/* Named per type so the partner knows which wall they hit. */}
              {usage.free.allocated && usage.discount.allocated
                ? `All ${usage.free.total} free and all ${usage.discount.total} discounted spots are used.`
                : usage.free.allocated
                  ? `All ${usage.free.total} free spots are used.`
                  : `All ${usage.discount.total} discounted spots are used.`}
              <span className="block mt-2 text-[13px]" style={{ color: '#8a8a8a' }}>
                Remove a guest below to free one up, or ask us for more.
              </span>
            </p>
          ) : (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="guest-name"
                  className="block text-[12px] font-semibold tracking-[0.14em] mb-2"
                  style={{ color: '#8a8a8a' }}
                >
                  GUEST NAME
                </label>
                <input
                  id="guest-name"
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  maxLength={MAX_GUEST_NAME_LENGTH}
                  placeholder="Name as it appears on their ID"
                  className="w-full px-5 py-3.5 rounded-full text-[15px] outline-none border transition-colors focus:border-white/30"
                  style={{ background: '#0f0f0f', borderColor: 'rgba(255,255,255,0.1)', color: '#f5f5f5' }}
                />
              </div>

              {showCompTypeChoice && (
                <fieldset>
                  <legend className="text-[12px] font-semibold tracking-[0.14em] mb-2" style={{ color: '#8a8a8a' }}>
                    ENTRY TYPE
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {addable.map((value) => {
                      const active = selectedCompType === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setCompType(value)}
                          aria-pressed={active}
                          className="px-5 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.12em] transition-colors"
                          style={
                            active
                              ? { background: '#ffffff', color: '#0a0a0a' }
                              : { color: '#a0a0a0', border: '1px solid rgba(255,255,255,0.12)' }
                          }
                        >
                          {compTypeLabel(value).toUpperCase()}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}

              {/* With only one type available there is no choice to present,
                  but the partner still needs to know what they are spending. */}
              {!showCompTypeChoice && selectedCompType && (
                <p className="text-[13px]" style={{ color: '#8a8a8a' }}>
                  Adding as <span style={{ color: '#f5f5f5' }}>{compTypeLabel(selectedCompType).toLowerCase()}</span>
                  {selectedCompType === 'discount' && grant.discount_detail
                    ? ` — ${grant.discount_detail}`
                    : ''}
                  {usage.free.allocated && usage.free.full && selectedCompType === 'discount'
                    ? `. All ${usage.free.total} free spots are used.`
                    : ''}
                  {usage.discount.allocated && usage.discount.full && selectedCompType === 'free'
                    ? `. All ${usage.discount.total} discounted spots are used.`
                    : ''}
                </p>
              )}

              <button
                type="submit"
                disabled={adding || !guestName.trim()}
                className="w-full sm:w-auto px-8 py-3.5 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0"
                style={{ background: '#ffffff', color: '#0a0a0a' }}
              >
                {adding ? 'ADDING...' : 'ADD TO LIST'}
              </button>
            </div>
          )}

          {error && <div className="text-[13px] text-red-400 mt-4">{error}</div>}
        </form>
      )}

      <div className="text-[12px] font-semibold tracking-[0.14em] mb-4" style={{ color: '#8a8a8a' }}>
        ON THE LIST ({entries.length})
      </div>

      {entries.length === 0 ? (
        <div
          className="rounded-[16px] border p-8 text-center"
          style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}
        >
          <p className="text-[14px]" style={{ color: '#8a8a8a' }}>
            Nobody on the list yet.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="rounded-[14px] border px-5 py-4 flex items-center justify-between gap-3"
              style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}
            >
              <div className="min-w-0">
                <div className="text-[15px] font-semibold break-words">{entry.guest_name}</div>
                <div className="text-[12px] mt-0.5" style={{ color: '#8a8a8a' }}>
                  {compTypeLabel(entry.comp_type)}
                </div>
              </div>

              <div className="flex items-center gap-3 flex-shrink-0">
                <StatusBadge status={entry.status} />
                {/* Withdrawing is only offered while the guest is still
                    pending; the API refuses it regardless of what the page
                    shows. A checked-in guest already came through the door and
                    that record is not the partner's to erase. */}
                {canRemoveEntry(entry) && (
                  <button
                    type="button"
                    onClick={() => handleRemove(entry)}
                    disabled={removingId === entry.id}
                    aria-label={`Remove ${entry.guest_name}`}
                    className="text-[11px] font-semibold tracking-[0.12em] px-3 py-2 rounded-full border transition-colors hover:bg-white/5 disabled:opacity-40"
                    style={{ borderColor: 'rgba(255,255,255,0.12)', color: '#c08a8a' }}
                  >
                    {removingId === entry.id ? '...' : 'REMOVE'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
