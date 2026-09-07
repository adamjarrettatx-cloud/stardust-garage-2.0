'use client';

// Ticketing panel — lives on the event editor.
//
// Three UI options for how an event sells tickets:
//   1) Default (us)  → events.ticketing_mode = 'internal'
//      Sell tickets with our own checkout. Products/tiers are configured
//      inline below.
//   2) External      → events.ticketing_mode = 'external'
//      Point buyers at some URL we don't control (Ticket Tailor, Eventbrite,
//      Dice, DoorList, whatever). The URL is stored on events.ticket_url so
//      the public event page can just link out.
//   3) Free event    → events.ticketing_mode = 'none'
//      No ticket widget shown; entry is free / RSVP / walk-up.
//
// Legacy note: some existing events were saved with ticketing_mode='tickettailor'
// before this refactor. They still work — the public event page has always
// used the TicketTailor embed regardless of ticketing_mode. In the editor
// we display them as "External" and pre-fill the URL from tt_event_series_id
// so the mapping is invisible to the user.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import ProductEditor from '@/components/ticketing/ProductEditor';
import PrivateSpacesManager from '@/components/ticketing/PrivateSpacesManager';
import DiscountCodesManager from '@/components/ticketing/DiscountCodesManager';

const UI_MODES = [
  {
    ui: 'default',
    db: 'internal',
    label: 'Default (us)',
    help: 'Sell tickets through our own checkout. Configure products below.',
  },
  {
    ui: 'external',
    db: 'external',
    label: 'External (other link)',
    help: 'Point buyers at another ticket site (Ticket Tailor, Eventbrite, Dice, DoorList, etc).',
  },
  {
    ui: 'free',
    db: 'none',
    label: 'Free event',
    help: 'No ticket widget on the event page. Free entry, RSVP, or walk-up.',
  },
];

// Convert whatever's in the DB into one of the three UI keys. Legacy
// 'tickettailor' collapses into 'external'.
function dbToUi(dbValue) {
  const v = (dbValue || '').toLowerCase();
  if (v === 'internal') return 'default';
  if (v === 'none') return 'free';
  // 'external', 'tickettailor', null, or anything else -> external
  return 'external';
}

// Build a TicketTailor URL from a series id when we don't have an explicit
// ticket_url stored. Used for legacy events so the External input isn't blank.
function ticketTailorUrl(seriesId) {
  if (!seriesId) return '';
  return `https://www.tickettailor.com/events/stardustgarage/${seriesId}`;
}

export default function TicketingPanel({
  eventId,
  initialMode,
  initialTicketUrl,
  initialTtSeriesId,
  initialBookingFeeCentsDefault = 295,
  initialMemberDiscountPercentCowork = null,
  initialMemberDiscountPercentIykyk = null,
}) {
  const supabase = createClient();

  const [uiMode, setUiMode] = useState(() => dbToUi(initialMode));
  const [savedUiMode, setSavedUiMode] = useState(() => dbToUi(initialMode));
  const [savingMode, setSavingMode] = useState(false);
  const [modeError, setModeError] = useState(null);

  const initialUrlSeed = initialTicketUrl || (initialMode === 'tickettailor' ? ticketTailorUrl(initialTtSeriesId) : '') || '';
  const [ticketUrl, setTicketUrl] = useState(initialUrlSeed);
  const [savedTicketUrl, setSavedTicketUrl] = useState(initialUrlSeed);

  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState(null);

  // Event-level default booking fee. Stored in cents in DB; edited in dollars.
  const [bookingFeeDollars, setBookingFeeDollars] = useState(() =>
    ((initialBookingFeeCentsDefault ?? 295) / 100).toFixed(2)
  );
  const [savedBookingFeeDollars, setSavedBookingFeeDollars] = useState(bookingFeeDollars);
  const [savingFee, setSavingFee] = useState(false);
  const [feeError, setFeeError] = useState(null);

  const bookingFeeCents = Math.round(parseFloat(bookingFeeDollars || '0') * 100);
  const bookingFeeDirty = bookingFeeDollars !== savedBookingFeeDollars;

  // Per-membership discount percents. Empty string means "no override" (falls
  // back to legacy events.member_discount_percent → category default).
  const [memberDiscountCowork, setMemberDiscountCowork] = useState(
    initialMemberDiscountPercentCowork != null ? String(initialMemberDiscountPercentCowork) : ''
  );
  const [memberDiscountIykyk, setMemberDiscountIykyk] = useState(
    initialMemberDiscountPercentIykyk != null ? String(initialMemberDiscountPercentIykyk) : ''
  );
  const [savedMemberDiscountCowork, setSavedMemberDiscountCowork] = useState(memberDiscountCowork);
  const [savedMemberDiscountIykyk, setSavedMemberDiscountIykyk] = useState(memberDiscountIykyk);
  const [savingMemberDiscounts, setSavingMemberDiscounts] = useState(false);
  const [memberDiscountError, setMemberDiscountError] = useState(null);
  const memberDiscountsDirty =
    memberDiscountCowork !== savedMemberDiscountCowork ||
    memberDiscountIykyk !== savedMemberDiscountIykyk;

  function parsePercentOrNull(v) {
    const s = String(v || '').trim();
    if (s === '') return null;
    const n = Number(s);
    if (!Number.isFinite(n)) throw new Error('Percent must be a number 0–100');
    if (n < 0 || n > 100) throw new Error('Percent must be between 0 and 100');
    return Math.round(n);
  }

  async function saveMemberDiscounts() {
    setSavingMemberDiscounts(true);
    setMemberDiscountError(null);
    try {
      const patch = {
        member_discount_percent_cowork: parsePercentOrNull(memberDiscountCowork),
        member_discount_percent_iykyk: parsePercentOrNull(memberDiscountIykyk),
      };
      const { error } = await supabase.from('events').update(patch).eq('id', eventId);
      if (error) throw error;
      setSavedMemberDiscountCowork(memberDiscountCowork);
      setSavedMemberDiscountIykyk(memberDiscountIykyk);
    } catch (e) {
      setMemberDiscountError(String(e.message || e));
    } finally {
      setSavingMemberDiscounts(false);
    }
  }

  async function saveBookingFee() {
    setSavingFee(true);
    setFeeError(null);
    try {
      const cents = Math.round(parseFloat(bookingFeeDollars || '0') * 100);
      if (!Number.isFinite(cents) || cents < 0) throw new Error('Fee must be $0 or greater');
      const { error } = await supabase
        .from('events')
        .update({ booking_fee_cents_default: cents })
        .eq('id', eventId);
      if (error) throw error;
      setSavedBookingFeeDollars(bookingFeeDollars);
    } catch (e) {
      setFeeError(String(e.message || e));
    } finally {
      setSavingFee(false);
    }
  }

  async function loadProducts() {
    setProductsLoading(true);
    setProductsError(null);
    try {
      const res = await fetch(`/api/admin/tickets/products?event_id=${eventId}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load products');
      setProducts(data.products || []);
    } catch (e) {
      setProductsError(String(e.message || e));
    } finally {
      setProductsLoading(false);
    }
  }

  useEffect(() => {
    if (savedUiMode === 'default') loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedUiMode, eventId]);

  const dirtyMode = uiMode !== savedUiMode;
  const dirtyUrl = uiMode === 'external' && ticketUrl !== savedTicketUrl;
  const dirty = dirtyMode || dirtyUrl;

  async function save() {
    setSavingMode(true);
    setModeError(null);
    try {
      const uiEntry = UI_MODES.find((m) => m.ui === uiMode);
      const patch = { ticketing_mode: uiEntry.db };
      if (uiMode === 'external') {
        patch.ticket_url = ticketUrl.trim() || null;
      } else if (uiMode === 'free') {
        patch.ticket_url = null;
      }
      // For 'default' (internal), leave ticket_url alone — it may still be a
      // useful fallback link during a switchover.
      const { error } = await supabase.from('events').update(patch).eq('id', eventId);
      if (error) throw error;
      setSavedUiMode(uiMode);
      if ('ticket_url' in patch) setSavedTicketUrl(patch.ticket_url || '');
    } catch (e) {
      setModeError(String(e.message || e));
    } finally {
      setSavingMode(false);
    }
  }

  return (
    <section
      className="mt-8"
      style={{
        border: '1px solid var(--auth-border, #333)',
        borderRadius: 8,
        padding: 20,
        background: 'var(--auth-panel-bg, transparent)',
      }}
    >
      <header style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 14, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Ticketing</h2>
        <p style={{ margin: '4px 0 0 0', fontSize: 12, opacity: 0.7 }}>
          Choose how this event sells tickets.
        </p>
      </header>

      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        {UI_MODES.map((m) => (
          <label
            key={m.ui}
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              padding: '10px 12px',
              border: `1px solid ${uiMode === m.ui ? 'var(--auth-accent, #7cf)' : 'var(--auth-border, #333)'}`,
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name={`ticketing-mode-${eventId}`}
              value={m.ui}
              checked={uiMode === m.ui}
              onChange={() => setUiMode(m.ui)}
              disabled={savingMode}
              style={{ marginTop: 3 }}
            />
            <span>
              <div style={{ fontWeight: 600 }}>{m.label}</div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>{m.help}</div>
            </span>
          </label>
        ))}
      </div>

      {uiMode === 'external' && (
        <div style={{ marginTop: 12 }}>
          <label style={{ display: 'block', fontSize: 12, opacity: 0.75, marginBottom: 4 }}>
            External ticket URL
          </label>
          <input
            type="url"
            value={ticketUrl}
            onChange={(e) => setTicketUrl(e.target.value)}
            placeholder="https://www.tickettailor.com/events/..."
            disabled={savingMode}
            style={{
              width: '100%',
              padding: '8px 10px',
              background: 'transparent',
              color: 'inherit',
              border: '1px solid var(--auth-border, #333)',
              borderRadius: 4,
              fontSize: 13,
            }}
          />
        </div>
      )}

      {modeError && <div style={{ color: '#f66', marginTop: 8, fontSize: 13 }}>{modeError}</div>}

      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || savingMode}
          className="auth-theme-border-button px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border"
          style={{ opacity: dirty ? 1 : 0.5 }}
        >
          {savingMode ? 'SAVING…' : dirty ? 'SAVE TICKETING' : 'SAVED'}
        </button>
        {dirty && (
          <button
            type="button"
            onClick={() => { setUiMode(savedUiMode); setTicketUrl(savedTicketUrl); setModeError(null); }}
            disabled={savingMode}
            style={{ fontSize: 12, opacity: 0.7, background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}
          >
            Cancel
          </button>
        )}
      </div>

      {/* Per-membership discount percents. Hidden when this event is free
          (no ticket price to discount) OR external (buyer checks out on a
          third-party site we don't control — our member codes can't apply
          there). Shown for internal ticketing and for the two legacy
          TicketTailor events, which both drive member-code generation. */}
      {savedUiMode !== 'free' && savedUiMode !== 'external' && (
      <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--auth-border, #333)' }}>
        <h3 style={{ margin: 0, fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Member discounts</h3>
        <p style={{ margin: '4px 0 12px 0', fontSize: 12, opacity: 0.7 }}>
          Percent off tickets for each active membership. Leave blank to fall back to the category default. Applied when member codes are generated for this event.
        </p>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, opacity: 0.75, marginBottom: 4 }}>
              The Weekender (%)
            </label>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={memberDiscountCowork}
              onChange={(e) => setMemberDiscountCowork(e.target.value)}
              disabled={savingMemberDiscounts}
              placeholder="e.g. 40"
              style={{
                padding: '6px 8px',
                background: 'transparent',
                color: 'inherit',
                border: '1px solid var(--auth-border, #333)',
                borderRadius: 4,
                fontSize: 13,
                width: 110,
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, opacity: 0.75, marginBottom: 4 }}>
              Experience Member (%)
            </label>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={memberDiscountIykyk}
              onChange={(e) => setMemberDiscountIykyk(e.target.value)}
              disabled={savingMemberDiscounts}
              placeholder="e.g. 60"
              style={{
                padding: '6px 8px',
                background: 'transparent',
                color: 'inherit',
                border: '1px solid var(--auth-border, #333)',
                borderRadius: 4,
                fontSize: 13,
                width: 110,
              }}
            />
          </div>
          <button
            type="button"
            onClick={saveMemberDiscounts}
            disabled={!memberDiscountsDirty || savingMemberDiscounts}
            className="auth-theme-border-button px-3 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border"
            style={{ opacity: memberDiscountsDirty ? 1 : 0.5 }}
          >
            {savingMemberDiscounts ? 'SAVING…' : memberDiscountsDirty ? 'SAVE MEMBER DISCOUNTS' : 'SAVED'}
          </button>
        </div>
        {memberDiscountError && (
          <div style={{ color: '#f66', marginTop: 8, fontSize: 13 }}>{memberDiscountError}</div>
        )}
      </div>
      )}

      {savedUiMode === 'default' && (
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--auth-border, #333)' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 20 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, opacity: 0.75, marginBottom: 4 }}>
                Default booking fee ($ per ticket)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={bookingFeeDollars}
                onChange={(e) => setBookingFeeDollars(e.target.value)}
                disabled={savingFee}
                style={{
                  padding: '6px 8px',
                  background: 'transparent',
                  color: 'inherit',
                  border: '1px solid var(--auth-border, #333)',
                  borderRadius: 4,
                  fontSize: 13,
                  width: 100,
                }}
              />
            </div>
            <button
              type="button"
              onClick={saveBookingFee}
              disabled={!bookingFeeDirty || savingFee}
              className="auth-theme-border-button px-3 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border"
              style={{ opacity: bookingFeeDirty ? 1 : 0.5 }}
            >
              {savingFee ? 'SAVING…' : bookingFeeDirty ? 'SAVE FEE' : 'SAVED'}
            </button>
            <span style={{ fontSize: 12, opacity: 0.6 }}>
              Applied to every ticket unless a tier overrides it.
            </span>
          </div>
          {feeError && <div style={{ color: '#f66', margin: '4px 0 12px 0', fontSize: 13 }}>{feeError}</div>}

          <h3 style={{ margin: 0, fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Tickets</h3>
          <p style={{ margin: '4px 0 12px 0', fontSize: 12, opacity: 0.7 }}>
            Build the ticket price ladder (e.g. Early Bird → Phase 1 → Phase 2 → General Admission). Buyers see tier names. Set per-tier status (hidden / sold out / access-code) as needed.
          </p>
          {productsError && <div style={{ color: '#f66', margin: '8px 0' }}>{productsError}</div>}
          {productsLoading && !products.length ? (
            <div style={{ opacity: 0.7, fontSize: 13 }}>Loading products…</div>
          ) : (
            <ProductEditor
              eventId={eventId}
              products={products}
              onReload={loadProducts}
              eventFeeDefault={bookingFeeCents}
            />
          )}

          <div style={{ marginTop: 28 }}>
            <h3 style={{ margin: 0, fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Private spaces</h3>
            <p style={{ margin: '4px 0 12px 0', fontSize: 12, opacity: 0.7 }}>
              Optional. Sell reservable private spaces alongside tickets (e.g. Outer Space — Green Room / Upstairs Office). Each space has its own price and capacity.
            </p>
            {productsLoading && !products.length ? (
              <div style={{ opacity: 0.7, fontSize: 13 }}>Loading…</div>
            ) : (
              <PrivateSpacesManager
                eventId={eventId}
                products={products}
                onReload={loadProducts}
              />
            )}
          </div>

          <div style={{ marginTop: 28 }}>
            <h3 style={{ margin: 0, fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Discount codes</h3>
            <p style={{ margin: '4px 0 12px 0', fontSize: 12, opacity: 0.7 }}>
              Optional promo codes for this event. Percent or fixed-amount off, scoped to all products or specific ones, with optional usage limits and windows.
            </p>
            <DiscountCodesManager
              eventId={eventId}
              products={products.filter((p) => (p.kind || 'tickets') === 'tickets')}
            />
          </div>

          <div style={{ marginTop: 20, fontSize: 12, opacity: 0.7 }}>
            Day-of operations (orders, refunds, scanner activity) live on the{' '}
            <a href={`/admin/tickets/${eventId}`} style={{ textDecoration: 'underline' }}>ticket operations console</a>.
          </div>
        </div>
      )}
    </section>
  );
}
