'use client';

// Ticketing panel for the event editor.
//
// One home for the two decisions someone setting up an event actually cares
// about:
//   1) Which ticket system runs this event? — sets events.ticketing_mode
//   2) If we're running it ourselves, what products/tiers are for sale?
//
// The separate /admin/tickets/[eventId] page is still the "day-of operations"
// console (orders, refunds, scanner activity). But setup lives here so it
// happens naturally as part of creating/editing the event.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import ProductEditor from '@/components/ticketing/ProductEditor';

const MODES = [
  { value: 'tickettailor', label: 'Ticket Tailor', help: 'External TicketTailor widget on the event page. This is the historical default.' },
  { value: 'internal', label: 'Internal (our system)', help: 'Sell tickets with our own checkout. Configure products below.' },
  { value: 'external', label: 'External (other link)', help: 'Point buyers to some other URL you manage yourself.' },
  { value: 'none', label: 'None / free', help: 'No ticketing widget shown on the event page.' },
];

function normalizeMode(m) {
  const v = (m || '').toLowerCase();
  return MODES.some((mm) => mm.value === v) ? v : 'tickettailor';
}

export default function TicketingPanel({ eventId, initialMode }) {
  const supabase = createClient();
  const [mode, setMode] = useState(normalizeMode(initialMode));
  const [savedMode, setSavedMode] = useState(normalizeMode(initialMode));
  const [savingMode, setSavingMode] = useState(false);
  const [modeError, setModeError] = useState(null);

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

  // Only load products when we're in internal mode — otherwise there's
  // nothing to show and the API is 404 with the flag off.
  useEffect(() => {
    if (savedMode === 'internal') loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedMode, eventId]);

  async function saveMode(next) {
    setSavingMode(true);
    setModeError(null);
    try {
      const { error } = await supabase.from('events').update({ ticketing_mode: next }).eq('id', eventId);
      if (error) throw error;
      setSavedMode(next);
      setMode(next);
    } catch (e) {
      setModeError(String(e.message || e));
      setMode(savedMode);
    } finally {
      setSavingMode(false);
    }
  }

  const dirty = mode !== savedMode;

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
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 14, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Ticketing</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 12, opacity: 0.7 }}>
            Choose how this event sells tickets. Configure products inline when you sell them yourself.
          </p>
        </div>
      </header>

      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        {MODES.map((m) => (
          <label
            key={m.value}
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              padding: '10px 12px',
              border: `1px solid ${mode === m.value ? 'var(--auth-accent, #7cf)' : 'var(--auth-border, #333)'}`,
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name={`ticketing-mode-${eventId}`}
              value={m.value}
              checked={mode === m.value}
              onChange={() => setMode(m.value)}
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

      {modeError && <div style={{ color: '#f66', marginTop: 8, fontSize: 13 }}>{modeError}</div>}

      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => saveMode(mode)}
          disabled={!dirty || savingMode}
          className="auth-theme-border-button px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border"
          style={{ opacity: dirty ? 1 : 0.5 }}
        >
          {savingMode ? 'SAVING…' : dirty ? 'SAVE TICKETING MODE' : 'SAVED'}
        </button>
        {dirty && (
          <button
            type="button"
            onClick={() => { setMode(savedMode); setModeError(null); }}
            disabled={savingMode}
            style={{ fontSize: 12, opacity: 0.7, background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}
          >
            Cancel
          </button>
        )}
      </div>

      {savedMode === 'internal' && (
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--auth-border, #333)' }}>
          <h3 style={{ margin: 0, fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Ticket products</h3>
          <p style={{ margin: '4px 0 12px 0', fontSize: 12, opacity: 0.7 }}>
            Create at least one product with one price tier. The buyer preview updates live so you can sanity-check dates and prices.
          </p>
          {productsError && <div style={{ color: '#f66', margin: '8px 0' }}>{productsError}</div>}
          {productsLoading && !products.length ? (
            <div style={{ opacity: 0.7, fontSize: 13 }}>Loading products…</div>
          ) : (
            <ProductEditor eventId={eventId} products={products} onReload={loadProducts} />
          )}
        </div>
      )}

      {savedMode === 'internal' && (
        <div style={{ marginTop: 20, fontSize: 12, opacity: 0.7 }}>
          Day-of operations (orders, refunds, scanner activity) live on the{' '}
          <a href={`/admin/tickets/${eventId}`} style={{ textDecoration: 'underline' }}>ticket operations console</a>.
        </div>
      )}
    </section>
  );
}
