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
import {
  MEMBER_PRICING_ROWS,
  resolveTicketDiscountPercent,
  defaultTicketDiscountPercent,
  WEEKEND_MUSIC_FIXED_PERCENT,
} from '@/lib/membership-tiers';
import { isEntitlementDiscountable } from '@/lib/tickets/pricing';

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

const memberCellStyle = {
  padding: '14px 12px 14px 0',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  fontSize: 13,
  verticalAlign: 'top',
};

const memberNoteStyle = {
  display: 'block',
  fontSize: 11,
  opacity: 0.5,
  marginTop: 3,
  lineHeight: 1.4,
  maxWidth: 230,
};

// Whether a tier is getting anything on this event, said in words rather than
// left for the reader to infer from an empty input.
function MemberPricingStatus({ percent }) {
  const on = percent > 0;
  return (
    <span
      style={{
        display: 'inline-block', fontSize: 10.5, letterSpacing: '0.07em',
        textTransform: 'uppercase', padding: '3px 9px', borderRadius: 20,
        whiteSpace: 'nowrap',
        border: `1px solid ${on ? 'rgba(143,211,154,0.35)' : 'var(--auth-border, #333)'}`,
        color: on ? '#8fd39a' : 'rgba(255,255,255,0.42)',
        background: on ? 'rgba(143,211,154,0.07)' : 'transparent',
      }}
    >
      {on ? `${percent}% off tickets` : 'No discount'}
    </span>
  );
}

export default function TicketingPanel({
  eventId,
  initialMode,
  initialTicketUrl,
  initialTtSeriesId,
  initialBookingFeeCentsDefault = 295,
  // Every membership's per-event percent, keyed by column name. null = use the
  // membership's default.
  initialMemberDiscounts = {},
  initialIsWeekendMusicExperience = false,
  // Event start (date + free-text time) — forwarded to ProductEditor so its
  // 'Ticket Sales End … hours after doors open' control can compute the
  // persisted `sales_end_at` timestamp relative to doors.
  eventDate = null,
  eventStartTime = null,
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

  // Event-level default booking fee. Not editable in the admin — the per-tier
  // Fee column in the ticket ladder handles overrides. The DB column stays
  // populated (schema default $2.95) and is still applied when a tier has no
  // override. We still read it here so ProductEditor can show it as the
  // placeholder value on tier fee inputs.
  const bookingFeeCents = initialBookingFeeCentsDefault ?? 295;

  // --- Member pricing -----------------------------------------------------
  //
  // Every membership rule for this event lives in one section, and every
  // membership type has its own percent box so a discount can be set on the fly.
  // The rules themselves are declared once in lib/membership-tiers.js — this
  // panel renders whatever rows that file defines and prices them with the same
  // resolver checkout uses, so the number shown here is the number charged.
  //
  // Blank box = use that membership's default. Turning on Weekend Music
  // Experience makes the default 25% for The Weekender and Trial SDG Pass;
  // everything else defaults to nothing.
  //
  // The toggle used to live on the main event form, a page away from the
  // percents it drives, and had never been switched on for a single event.
  const [isWeekendMusic, setIsWeekendMusic] = useState(!!initialIsWeekendMusicExperience);
  const [savedIsWeekendMusic, setSavedIsWeekendMusic] = useState(!!initialIsWeekendMusicExperience);

  const [percents, setPercents] = useState(() => {
    const seed = {};
    for (const row of MEMBER_PRICING_ROWS) {
      const v = initialMemberDiscounts?.[row.discountColumn];
      seed[row.key] = v != null ? String(v) : '';
    }
    return seed;
  });
  const [savedPercents, setSavedPercents] = useState(percents);
  const [savingMemberDiscounts, setSavingMemberDiscounts] = useState(false);
  const [memberDiscountError, setMemberDiscountError] = useState(null);

  const memberDiscountsDirty =
    isWeekendMusic !== savedIsWeekendMusic ||
    MEMBER_PRICING_ROWS.some((row) => percents[row.key] !== savedPercents[row.key]);

  // Clamped to the row's own ceiling rather than a flat 100. Typing 80 in the
  // Insider box and having checkout quietly charge 60 would be worse than
  // refusing to save it.
  function parsePercentOrNull(v, max) {
    const raw = String(v ?? '').trim();
    if (raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error('Percent must be a number');
    if (n < 0 || n > max) throw new Error(`Percent must be between 0 and ${max}`);
    return Math.round(n);
  }

  async function saveMemberDiscounts() {
    setSavingMemberDiscounts(true);
    setMemberDiscountError(null);
    try {
      const patch = { is_weekend_music_experience: isWeekendMusic };
      for (const row of MEMBER_PRICING_ROWS) {
        patch[row.discountColumn] = parsePercentOrNull(
          percents[row.key],
          row.ticketDiscount?.maxPercent ?? 100,
        );
      }
      const { error } = await supabase.from('events').update(patch).eq('id', eventId);
      if (error) throw error;
      setSavedPercents(percents);
      setSavedIsWeekendMusic(isWeekendMusic);
    } catch (e) {
      setMemberDiscountError(String(e.message || e));
    } finally {
      setSavingMemberDiscounts(false);
    }
  }

  // A synthetic event row built from what is on screen, so the preview and the
  // status pills reflect unsaved edits while still going through the one
  // resolver that prices the real checkout.
  const draftEvent = (() => {
    const draft = { is_weekend_music_experience: isWeekendMusic };
    for (const row of MEMBER_PRICING_ROWS) {
      const raw = String(percents[row.key] ?? '').trim();
      draft[row.discountColumn] = raw === '' ? null : Number(raw);
    }
    return draft;
  })();

  function percentFor(row) {
    return resolveTicketDiscountPercent(draftEvent, row);
  }

  // Every active price on the event. `discountable` mirrors the server rule:
  // membership discounts touch ticket products only, never a private-space
  // rental sold on the same event.
  const previewLines = (products || [])
    .flatMap((p) =>
      (p.tiers || [])
        .filter((t) => t.is_active !== false)
        .map((t) => ({
          product: p.name || 'Tickets',
          tier: t.name || '\u2014',
          cents: Number(t.price_cents) || 0,
          discountable: isEntitlementDiscountable(p),
          order: (p.display_order ?? 0) * 100 + (t.display_order ?? 0),
        }))
    )
    .filter((l) => l.cents > 0)
    .sort((a2, b2) => a2.order - b2.order);

  const multiProduct = new Set(previewLines.map((l) => l.product)).size > 1;
  const hasRental = previewLines.some((l) => !l.discountable);

  function money(cents) {
    return `$${(cents / 100).toFixed(2)}`;
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

  // Load products whenever the UI is showing the Default (internal) mode —
  // driven by the live selection, not the persisted one, so previewing the
  // Default panel populates the editor immediately even before Save Ticketing.
  // Products are already scoped to this event, so a preview-mode GET is cheap.
  useEffect(() => {
    if (uiMode === 'default') loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiMode, eventId]);

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

      {/* MEMBER PRICING \u2014 every membership rule for this event in one place.
          Hidden when the event is free (no price to discount) or external
          (the buyer checks out somewhere we don't control). */}
      {uiMode !== 'free' && uiMode !== 'external' && (
      <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--auth-border, #333)' }}>
        <h3 style={{ margin: 0, fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Member pricing</h3>
        <p style={{ margin: '5px 0 18px 0', fontSize: 12, opacity: 0.7, lineHeight: 1.5 }}>
          What each membership pays for a ticket on this event. Set any percent you like on any membership;
          leave a box blank to use that membership&rsquo;s standard rate.
        </p>

        <label
          style={{
            display: 'flex', gap: 11, alignItems: 'flex-start', cursor: 'pointer',
            padding: '13px 14px', borderRadius: 8, marginBottom: 20,
            border: `1px solid ${isWeekendMusic ? 'var(--auth-accent, #7cf)' : 'var(--auth-border, #333)'}`,
            background: isWeekendMusic ? 'rgba(119,204,255,0.06)' : 'transparent',
          }}
        >
          <input
            type="checkbox"
            checked={isWeekendMusic}
            onChange={(e) => setIsWeekendMusic(e.target.checked)}
            disabled={savingMemberDiscounts}
            style={{ marginTop: 2, width: 16, height: 16, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 13 }}>
            <b style={{ fontWeight: 600 }}>Weekend Music Experience</b>
            <span style={{ display: 'block', fontSize: 11.5, opacity: 0.65, marginTop: 3, lineHeight: 1.45 }}>
              Fri&ndash;Sun music night. Turning this on makes {WEEKEND_MUSIC_FIXED_PERCENT}% the standard rate
              for The Weekender and Trial SDG Pass holders &mdash; their standing benefit. Any box below still overrides it.
            </span>
          </span>
        </label>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Membership', 'Discount on tickets', 'On this event'].map((h, i) => (
                <th
                  key={h}
                  style={{
                    textAlign: 'left', fontSize: 10.5, letterSpacing: '0.1em',
                    textTransform: 'uppercase', opacity: 0.55, fontWeight: 600,
                    padding: '0 12px 9px 0', borderBottom: '1px solid var(--auth-border, #333)',
                    width: i === 0 ? 200 : i === 1 ? 175 : 'auto',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MEMBER_PRICING_ROWS.map((row) => {
              const max = row.ticketDiscount?.maxPercent ?? 100;
              const fallback = defaultTicketDiscountPercent(draftEvent, row);
              const isOverridden = String(percents[row.key] ?? '').trim() !== '';
              const pct = percentFor(row);
              return (
                <tr key={row.key}>
                  <td style={memberCellStyle}>
                    <b style={{ fontWeight: 600 }}>{row.label}</b>
                    <span style={memberNoteStyle}>{row.priceLabel}</span>
                  </td>
                  <td style={memberCellStyle}>
                    <input
                      type="number"
                      min="0"
                      max={max}
                      step="1"
                      value={percents[row.key] ?? ''}
                      onChange={(e) => setPercents((prev) => ({ ...prev, [row.key]: e.target.value }))}
                      disabled={savingMemberDiscounts}
                      placeholder={String(fallback)}
                      aria-label={`${row.label} ticket discount percent`}
                      style={{
                        width: 62, padding: '6px 8px', background: 'transparent',
                        color: 'inherit', borderRadius: 4, fontSize: 13, textAlign: 'right',
                        border: `1px solid ${isOverridden ? 'var(--auth-accent, #7cf)' : 'var(--auth-border, #333)'}`,
                      }}
                    />
                    {' %'}
                    <span style={memberNoteStyle}>
                      {isOverridden
                        ? `Set for this event \u00b7 max ${max}`
                        : fallback > 0
                          ? `Blank \u2192 ${fallback}% standard rate`
                          : `Blank \u2192 no discount \u00b7 max ${max}`}
                    </span>
                  </td>
                  <td style={memberCellStyle}>
                    <MemberPricingStatus percent={pct} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* WHAT A MEMBER ACTUALLY PAYS \u2014 resolved against this event's real
            prices so nobody has to do percentage arithmetic in their head, and
            so it's visible that a rental is not discounted. */}
        {previewLines.length > 0 && (
          <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--auth-border, #333)' }}>
            <div style={{ fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.55, fontWeight: 600, marginBottom: 10 }}>
              What a member actually pays
            </div>
            {[...MEMBER_PRICING_ROWS.map((row) => ({ label: row.label, percent: percentFor(row) })),
              { label: 'Non-member', percent: 0 }].map((rowSummary) => (
              <div key={rowSummary.label} style={{ display: 'flex', gap: 14, fontSize: 12.5, marginBottom: 9, lineHeight: 1.7 }}>
                <span style={{ minWidth: 150, flex: '0 0 auto', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.5 }}>
                  {rowSummary.label}
                </span>
                {/* One line per price when more than one product is on sale,
                    so a rental's price can't wrap away from its name. */}
                <span style={{ minWidth: 0 }}>
                  {previewLines.map((l, i) => {
                    const off = l.discountable ? rowSummary.percent : 0;
                    return (
                      <span key={`${l.product}-${l.tier}-${i}`} style={multiProduct ? { display: 'block' } : undefined}>
                        {i > 0 && !multiProduct && <span style={{ opacity: 0.3 }}>{' \u00b7 '}</span>}
                        <span style={{ opacity: 0.9 }}>
                          {multiProduct ? `${l.product} \u2013 ${l.tier}` : l.tier}
                        </span>{' '}
                        {off > 0 ? (
                          <>
                            <span style={{ opacity: 0.55 }}>{money(l.cents)}</span>
                            <span style={{ opacity: 0.35 }}>{' \u2192 '}</span>
                            <b style={{ color: '#8fd39a', fontWeight: 600 }}>
                              {money(l.cents - Math.floor((l.cents * off) / 100))}
                            </b>
                          </>
                        ) : (
                          <>
                            <span style={{ opacity: 0.55 }}>{money(l.cents)}</span>
                            {!l.discountable && rowSummary.percent > 0 && (
                              <span style={{ opacity: 0.45, fontSize: 11 }}>{' \u2014 not a ticket, full price'}</span>
                            )}
                          </>
                        )}
                      </span>
                    );
                  })}
                </span>
              </div>
            ))}
            <p style={{ margin: '10px 0 0 0', fontSize: 11, opacity: 0.5, lineHeight: 1.5 }}>
              Member discounts apply to ticket products only{hasRental ? ' \u2014 the private space above is always charged in full' : ''}.
              They never come off the booking fee, and they never stack with a discount code: a buyer holding
              both gets whichever is worth more.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={saveMemberDiscounts}
          disabled={!memberDiscountsDirty || savingMemberDiscounts}
          className="auth-theme-border-button px-3 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border"
          style={{ marginTop: 22, opacity: memberDiscountsDirty ? 1 : 0.5 }}
        >
          {savingMemberDiscounts ? 'SAVING\u2026' : memberDiscountsDirty ? 'SAVE MEMBER PRICING' : 'SAVED'}
        </button>
        {memberDiscountError && (
          <div style={{ color: '#f66', marginTop: 8, fontSize: 13 }}>{memberDiscountError}</div>
        )}
      </div>
      )}

      {uiMode === 'default' && (
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--auth-border, #333)' }}>
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
              eventDate={eventDate}
              eventStartTime={eventStartTime}
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
