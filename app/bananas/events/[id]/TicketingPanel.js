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

export default function TicketingPanel({ eventId, initialMode, initialTicketUrl, initialTtSeriesId }) {
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

      {savedUiMode === 'default' && (
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--auth-border, #333)' }}>
          <h3 style={{ margin: 0, fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Ticket products</h3>
          <p style={{ margin: '4px 0 12px 0', fontSize: 12, opacity: 0.7 }}>
            Create at least one product with one price tier. Buyer preview updates live so you can sanity-check dates and prices.
          </p>
          {productsError && <div style={{ color: '#f66', margin: '8px 0' }}>{productsError}</div>}
          {productsLoading && !products.length ? (
            <div style={{ opacity: 0.7, fontSize: 13 }}>Loading products…</div>
          ) : (
            <ProductEditor eventId={eventId} products={products} onReload={loadProducts} />
          )}
          <div style={{ marginTop: 20, fontSize: 12, opacity: 0.7 }}>
            Day-of operations (orders, refunds, scanner activity) live on the{' '}
            <a href={`/admin/tickets/${eventId}`} style={{ textDecoration: 'underline' }}>ticket operations console</a>.
          </div>
        </div>
      )}
    </section>
  );
}
