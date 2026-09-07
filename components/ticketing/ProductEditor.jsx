'use client';
import { useMemo, useState } from 'react';
import {
  HOURS_AFTER_DOORS_OPTIONS,
  resolveEventStartDate,
  hoursAfterDoorsFromIso,
  isoForHoursAfterDoors,
} from '@/lib/tickets/sales-end-hours';
import {
  T,
  cardStyle,
  fieldLabelStyle,
  inputStyle,
  pillClass,
  primaryPillStyle,
  ghostPillStyle,
  CheckboxRow,
  sectionHeaderStyle,
  sectionSubStyle,
  tableStyle,
  thStyle,
  tdStyle,
  statusPill,
} from './ticketingTheme.js';
import MoneyInput from './MoneyInput.jsx';

// Inline product + tier editor.
//
// Themed to match the rest of the bananas admin (auth-* CSS vars, Plus Jakarta
// Sans, pill CTAs). All the underlying save/delete/reveal-threshold logic is
// unchanged from the previous version.

// ---- helpers ----
function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function money(cents, currency = 'usd') {
  if (typeof cents !== 'number') return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
function centsToDollarInput(c) {
  return typeof c === 'number' ? (c / 100).toFixed(2) : '';
}
function dollarInputToCents(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function blankProduct(eventId) {
  return {
    id: null,
    event_id: eventId,
    // Always auto-named 'Tickets' — not shown in the admin UI. The visible
    // labels a buyer sees are the tier names (Early Bird / Phase 1 / GA).
    name: 'Tickets',
    description: '',
    kind: 'tickets',
    member_only: false,
    // Locked platform defaults — no admin UI. Every buyer can grab 1–20 in one
    // order. If we ever want per-product overrides, they'd move back into the UI
    // as an advanced toggle; today keeping them constant beats the confusion.
    min_per_order: 1,
    max_per_order: 20,
    capacity: null,
    display_order: 0,
    is_active: true,
    // Fixed at 10: reveal the next tier when the current one has ≤ 10 left.
    // Manually 'hidden' tiers never appear regardless of this threshold, which
    // is why the field is no longer editable in the admin UI.
    tier_reveal_threshold: 10,
    // Event-wide ticket-sales cutoff. Enforced by lib/tickets/pricing.js
    // (canBuyProduct). Blank = no cutoff — sales run until event ends.
    sales_start_at: null,
    sales_end_at: null,
    tiers: [
      {
        id: null,
        name: 'General',
        price_cents: 2000,
        // Per-tier windows are no longer editable in the admin — we advance
        // tiers by display_order + sold-out, and use the product-level
        // sales_end_at as the master cutoff. Left in the shape for the API
        // and pricing.js which still accept them.
        starts_at: null,
        ends_at: null,
        is_active: true,
        display_order: 0,
        status: 'active',
        access_codes: [],
        booking_fee_cents_override: null,
        quantity: null,
      },
    ],
  };
}

function toEditShape(p) {
  return {
    ...p,
    description: p.description || '',
    // Always 10 — the field is no longer editable but the DB column stays
    // so pricing/availability logic keeps working unchanged.
    tier_reveal_threshold: 10,
    capacity: p.capacity ?? null,
    sales_start_at: p.sales_start_at || null,
    sales_end_at: p.sales_end_at || null,
    tiers: (p.tiers || []).map((t) => ({
      ...t,
      quantity: typeof t.quantity === 'number' ? t.quantity : null,
      access_codes: Array.isArray(t.access_codes) ? t.access_codes : [],
    })),
  };
}

// Compute a preview of which tier is currently "buyable" — mirrors
// selectActiveTier() from lib/tickets/pricing.js closely enough for a UI
// preview. Server is authoritative.
function resolveActiveTier(tiers, now = new Date()) {
  const buyable = tiers.filter((t) => t.is_active !== false && (t.status || 'active') === 'active');
  const hit = buyable.find((t) => {
    const s = t.starts_at ? new Date(t.starts_at) : null;
    const e = t.ends_at ? new Date(t.ends_at) : null;
    if (s && now < s) return false;
    if (e && now > e) return false;
    return true;
  });
  return hit || buyable[0] || null;
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'hidden', label: 'Hidden' },
  { value: 'sold_out', label: 'Sold out' },
  { value: 'access_code', label: 'Access code required' },
];

// ---- tier row ----
// Grid columns (kept in sync with the header row below):
//   24px drag handle | tier name | price | qty | status | fee | 32px delete
//
// Per-tier Starts/Ends columns were removed in favor of a single event-level
// 'Ticket sales end at' field on the product form. Tiers advance in the order
// listed (drag to reorder) and by sold-out, not by scheduled windows.
const TIER_GRID = '24px minmax(160px, 1.6fr) 100px 90px minmax(140px, 1fr) 100px 32px';

function TierRow({
  tier,
  index,
  onChange,
  onDelete,
  canDelete,
  eventFeeDefault,
  // drag props from parent
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}) {
  const status = tier.status || 'active';
  const feePlaceholder = centsToDollarInput(eventFeeDefault ?? 295);

  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        display: 'grid',
        gap: 8,
        gridTemplateColumns: TIER_GRID,
        alignItems: 'center',
        padding: '10px 12px',
        borderBottom: `1px solid ${T.borderSoft}`,
        fontSize: 13,
        color: T.text,
        fontFamily: T.fontStack,
        opacity: isDragging ? 0.4 : 1,
        background: isDragOver ? 'rgba(0,0,0,0.04)' : 'transparent',
        transition: 'background 120ms ease',
      }}
    >
      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        title="Drag to reorder"
        style={{
          cursor: 'grab',
          userSelect: 'none',
          color: T.faint,
          fontSize: 16,
          lineHeight: 1,
          textAlign: 'center',
          padding: '4px 0',
        }}
      >
        ⋮⋮
      </div>
      <input
        type="text"
        value={tier.name || ''}
        onChange={(e) => onChange({ ...tier, name: e.target.value })}
        placeholder="Early bird"
        style={inputStyle()}
      />
      {/* Dollar amount. Uses MoneyInput (type=text + local draft) so the
          mouse wheel can't nudge the value while the field is focused and
          so mid-typing values like "25" or "25." aren't reformatted to
          "25.00" on every keystroke. Stored as integer cents; blank is
          not allowed here — empty snaps back to 0. */}
      <MoneyInput
        valueCents={tier.price_cents}
        onChangeCents={(c) => onChange({ ...tier, price_cents: c ?? 0 })}
        style={inputStyle()}
        title="Price ($)"
        placeholder="0.00"
      />
      <input
        type="number"
        min="0"
        step="1"
        value={tier.quantity ?? ''}
        onChange={(e) => onChange({
          ...tier,
          quantity: e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10) || 0),
        })}
        placeholder="∞"
        style={inputStyle()}
        title="Quantity available at this tier. Blank = unlimited."
      />
      <select
        value={status}
        onChange={(e) => onChange({ ...tier, status: e.target.value })}
        title="Status"
        style={inputStyle()}
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {/* Booking fee override: blank means "use event default", so this
          MoneyInput allows empty. Same reasons as the price field above
          for switching away from type="number". */}
      <MoneyInput
        valueCents={tier.booking_fee_cents_override}
        onChangeCents={(c) => onChange({ ...tier, booking_fee_cents_override: c })}
        allowEmpty
        placeholder={feePlaceholder}
        title="Booking fee override ($). Blank = event default."
        style={inputStyle()}
      />
      <button
        type="button"
        onClick={onDelete}
        disabled={!canDelete}
        title={canDelete ? 'Remove tier' : 'Need at least one tier'}
        style={{
          border: 0,
          background: 'transparent',
          cursor: canDelete ? 'pointer' : 'default',
          fontSize: 20,
          color: canDelete ? T.danger : T.faint,
          padding: 4,
        }}
      >
        ×
      </button>
    </div>
  );
}

function AccessCodesInput({ tier, onChange }) {
  if ((tier.status || 'active') !== 'access_code') return null;
  const asString = (tier.access_codes || []).join(', ');
  return (
    <div style={{ padding: '10px 12px', fontSize: 12, background: T.innerBg, borderBottom: `1px solid ${T.borderSoft}` }}>
      <div style={{ color: T.muted, marginBottom: 6 }}>
        Access codes for “{tier.name || 'this tier'}” — comma-separated. Case-insensitive.
      </div>
      <input
        type="text"
        value={asString}
        onChange={(e) => {
          const codes = e.target.value
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean);
          onChange({ ...tier, access_codes: codes });
        }}
        placeholder="VIP2026, FRIENDS, PRESALE"
        style={inputStyle()}
      />
    </div>
  );
}

// ---- product form ----
function ProductForm({ eventId, initial, onSave, onCancel, saving, eventFeeDefault, eventDate = null, eventStartTime = null }) {
  const [p, setP] = useState(() => (initial ? toEditShape(initial) : blankProduct(eventId)));

  // Resolve the event's doors-open moment once per render — this is what the
  // 'N hours after doors open' dropdown is anchored to. Null when the event's
  // start time is missing or free-form text we can't parse ("doors at dusk").
  const eventStart = useMemo(
    () => resolveEventStartDate(eventDate, eventStartTime),
    [eventDate, eventStartTime]
  );

  // Local dropdown state for the 'Ticket Sales End' control. Seeded from the
  // persisted sales_end_at when it lines up on a whole hour after doors, and
  // otherwise 'No cutoff' — leaving the stored value unchanged until the user
  // actively picks a new option.
  const [hoursAfterDoors, setHoursAfterDoors] = useState(
    () => hoursAfterDoorsFromIso(p.sales_end_at, eventStart)
  );

  const activeTier = useMemo(() => resolveActiveTier(p.tiers), [p.tiers]);
  // The product's own name is always 'Tickets' behind the scenes and not
  // shown in the UI — buyers see tier names. So we only validate tiers.
  const nameValid = true;
  const tiersValid = p.tiers.length > 0 && p.tiers.every((t) =>
    t.name?.trim() &&
    Number.isFinite(t.price_cents) &&
    t.price_cents >= 0 &&
    (t.status !== 'access_code' || (t.access_codes && t.access_codes.length > 0))
  );
  const canSave = nameValid && tiersValid && !saving;

  function updateTier(index, next) {
    setP({ ...p, tiers: p.tiers.map((t, i) => (i === index ? next : t)) });
  }
  function addTier() {
    setP({
      ...p,
      tiers: [
        ...p.tiers,
        {
          id: null, name: '', price_cents: 2000,
          starts_at: null, ends_at: null,
          is_active: true, display_order: p.tiers.length,
          status: 'active', access_codes: [],
          booking_fee_cents_override: null,
          quantity: null,
        },
      ],
    });
  }
  function removeTier(index) {
    if (p.tiers.length <= 1) return;
    setP({ ...p, tiers: p.tiers.filter((_, i) => i !== index) });
  }

  // --- drag-and-drop reorder for tier rows ---
  // Order is by array index; submit() writes display_order: i so the DB
  // half is automatic. dragIndex is the row being dragged; overIndex is the
  // row it's currently hovered over (for the highlight).
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  function handleTierDragStart(i, e) {
    setDragIndex(i);
    // Firefox needs setData to enable the drag.
    try { e.dataTransfer.setData('text/plain', String(i)); } catch {}
    e.dataTransfer.effectAllowed = 'move';
  }
  function handleTierDragOver(i, e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overIndex !== i) setOverIndex(i);
  }
  function handleTierDrop(i, e) {
    e.preventDefault();
    const from = dragIndex;
    setDragIndex(null);
    setOverIndex(null);
    if (from === null || from === i) return;
    setP((prev) => {
      const next = prev.tiers.slice();
      const [moved] = next.splice(from, 1);
      next.splice(i, 0, moved);
      return { ...prev, tiers: next };
    });
  }
  function handleTierDragEnd() {
    setDragIndex(null);
    setOverIndex(null);
  }

  function submit() {
    const payload = {
      ...p,
      // Force the invisible-in-UI product name to 'Tickets' so the DB row is
      // stable regardless of whether it was ever edited elsewhere.
      name: 'Tickets',
      kind: 'tickets',
      description: p.description?.trim() || null,
      // Hardcoded default: always reveal the next tier at ≤ 10 remaining.
      // Next-tier visibility is controlled per-tier via status='hidden'.
      tier_reveal_threshold: 10,
      // Product-level capacity is no longer used — stock is per tier now.
      // Pass null so the API leaves the per-product ticket_inventory row
      // unlimited (existing rows are left untouched).
      capacity: null,
      tiers: p.tiers.map((t, i) => ({
        ...t,
        display_order: i,
        access_codes: t.status === 'access_code' ? (t.access_codes || []) : null,
        quantity:
          t.quantity === '' || t.quantity === null || t.quantity === undefined
            ? null
            : Math.max(0, Number(t.quantity)),
      })),
    };
    onSave(payload);
  }

  return (
    <div style={{ ...cardStyle({ padding: 20 }), marginBottom: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
        <div>
          <div style={fieldLabelStyle()}>Ticket sales end</div>
          {eventStart ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <select
                  value={hoursAfterDoors == null ? '' : String(hoursAfterDoors)}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') {
                      setHoursAfterDoors(null);
                      setP({ ...p, sales_end_at: null });
                      return;
                    }
                    const n = parseInt(v, 10);
                    setHoursAfterDoors(n);
                    setP({ ...p, sales_end_at: isoForHoursAfterDoors(eventStart, n) });
                  }}
                  style={{ ...inputStyle(), width: 'auto', minWidth: 96 }}
                  title="How many hours after doors open online sales stay live."
                >
                  <option value="">— No cutoff —</option>
                  {HOURS_AFTER_DOORS_OPTIONS.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
                <span style={{ fontSize: 13, color: T.text, fontFamily: T.fontStack }}>
                  {hoursAfterDoors == null
                    ? 'hours after doors open (no cutoff)'
                    : `hour${hoursAfterDoors === 1 ? '' : 's'} after doors open`}
                </span>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: T.muted, fontFamily: T.fontStack }}>
                {hoursAfterDoors == null ? (
                  <>Sales run until the event ends. Doors open{' '}
                    <strong style={{ color: T.strongText }}>{eventStart.toLocaleString()}</strong>.</>
                ) : (
                  <>Sales close automatically at{' '}
                    <strong style={{ color: T.strongText }}>
                      {new Date(eventStart.getTime() + hoursAfterDoors * 60 * 60 * 1000).toLocaleString()}
                    </strong>.</>
                )}
              </div>
            </>
          ) : (
            // Fallback when the event has no parseable start time yet (empty,
            // or free-form text like "doors at dusk"). We keep the raw ISO
            // input so an admin can still set a cutoff, and nudge them to fix
            // the event start time so the dropdown becomes available.
            <>
              <input
                type="datetime-local"
                value={isoToLocalInput(p.sales_end_at)}
                onChange={(e) => setP({ ...p, sales_end_at: localInputToIso(e.target.value) })}
                style={inputStyle()}
                title="When online ticket sales close. Blank = sales run until the event ends."
              />
              <div style={{ marginTop: 6, fontSize: 12, color: T.muted, fontFamily: T.fontStack }}>
                Set the event start time above (e.g. “10:00 PM”) to pick the cutoff as “N hours after doors open” instead.
              </div>
            </>
          )}
        </div>

        {/* Audience: mutually-exclusive Public vs Members Only.
            Public (default) = anyone can buy. Members Only = restricted to
            active members via member_only. is_active stays true from this UI
            — fully retiring a product happens via the row-level delete/archive
            action, not by unchecking a box that overlapped with 'members only'. */}
        <div>
          <div style={fieldLabelStyle()}>Audience</div>
          <div
            role="radiogroup"
            aria-label="Audience"
            style={{ display: 'inline-flex', border: `1px solid ${T.border}`, borderRadius: 999, overflow: 'hidden' }}
          >
            {[
              { value: 'public', label: 'Public' },
              { value: 'members', label: 'Members Only' },
            ].map((opt) => {
              const selected = (p.member_only ? 'members' : 'public') === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setP({ ...p, member_only: opt.value === 'members', is_active: true })}
                  style={{
                    padding: '6px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    cursor: 'pointer',
                    background: selected ? T.strongText : 'transparent',
                    color: selected ? 'var(--auth-strong-surface-text, #fff)' : T.text,
                    border: 'none',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <h4 style={{ ...sectionHeaderStyle(), marginTop: 24, marginBottom: 4, fontSize: 12 }}>Price tiers</h4>
      <p style={sectionSubStyle()}>
        Tiers show in the order listed below — first row is the first tier buyers see. Drag the ⋮⋮ handle to reorder. Set a Qty for each tier to cap how many tickets sell at that price (blank = unlimited); once a tier sells out, the next one takes over. The tier name is what buyers see. Booking fee override is per ticket in dollars — blank uses the event default.
      </p>

      <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, overflow: 'hidden', background: T.cardBg }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: TIER_GRID,
            gap: 8,
            fontSize: 11,
            color: T.muted,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontWeight: 600,
            padding: '10px 12px',
            borderBottom: `1px solid ${T.border}`,
            background: T.innerBg,
            fontFamily: T.fontStack,
          }}
        >
          <span />
          <span>Tier name</span>
          <span>Price $</span>
          <span>Qty</span>
          <span>Status</span>
          <span>Fee $</span>
          <span />
        </div>
        {p.tiers.map((t, i) => (
          <div key={t.id || `new-${i}`}>
            <TierRow
              tier={t}
              index={i}
              onChange={(next) => updateTier(i, next)}
              onDelete={() => removeTier(i)}
              canDelete={p.tiers.length > 1}
              eventFeeDefault={eventFeeDefault}
              isDragging={dragIndex === i}
              isDragOver={overIndex === i && dragIndex !== null && dragIndex !== i}
              onDragStart={(e) => handleTierDragStart(i, e)}
              onDragOver={(e) => handleTierDragOver(i, e)}
              onDrop={(e) => handleTierDrop(i, e)}
              onDragEnd={handleTierDragEnd}
            />
            <AccessCodesInput tier={t} onChange={(next) => updateTier(i, next)} />
          </div>
        ))}
        <div style={{ padding: '10px 12px', borderTop: `1px solid ${T.borderSoft}`, background: T.innerBg }}>
          <button
            type="button"
            onClick={addTier}
            className={pillClass()}
            style={ghostPillStyle()}
          >
            + ADD TIER
          </button>
        </div>
      </div>

      <div
        style={{
          marginTop: 16,
          padding: 14,
          background: T.innerBg,
          border: `1px solid ${T.borderSoft}`,
          borderRadius: 10,
          fontSize: 13,
          color: T.text,
          fontFamily: T.fontStack,
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.muted, marginBottom: 6 }}>
          Buyer preview
        </div>
        <div>
          {nameValid ? <strong style={{ color: T.strongText }}>{p.name}</strong> : <em style={{ color: T.faint }}>(name required)</em>}
          {p.member_only ? <span style={{ color: T.muted }}> · members only</span> : ''}
        </div>
        <div style={{ marginTop: 4 }}>
          Current price:{' '}
          {activeTier ? (
            <span>
              <strong style={{ color: T.strongText }}>{money(activeTier.price_cents)}</strong>
              {activeTier.name ? ` — ${activeTier.name}` : ''}
              {' · +'}
              {money(
                Number.isInteger(activeTier.booking_fee_cents_override)
                  ? activeTier.booking_fee_cents_override
                  : (eventFeeDefault ?? 295)
              )}
              {' booking fee'}
            </span>
          ) : (
            <em style={{ color: T.faint }}>no buyable tier right now (all hidden / sold out / gated)</em>
          )}
        </div>
      </div>

      <div style={{ marginTop: 20, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={submit}
          disabled={!canSave}
          className={pillClass('primary')}
          style={primaryPillStyle({ disabled: !canSave })}
        >
          {saving ? 'SAVING…' : (p.id ? 'SAVE CHANGES' : 'CREATE PRODUCT')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className={pillClass()}
          style={ghostPillStyle({ disabled: saving })}
        >
          CANCEL
        </button>
        {!tiersValid && (
          <span style={{ color: T.danger, fontSize: 12 }}>
            Each tier needs a name, price, and if status is &quot;Access code required&quot;, at least one access code
          </span>
        )}
      </div>
    </div>
  );
}

// ---- top-level manager ----
export default function ProductEditor({ eventId, products, onReload, eventFeeDefault, eventDate = null, eventStartTime = null }) {
  const [editing, setEditing] = useState(null); // null | 'new' | product-id
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  // Only render the default 'tickets' product here. Private-space rentals
  // live in their own PrivateSpacesManager section below the ticketing UI.
  const ticketsProducts = (products || []).filter((p) => (p.kind || 'tickets') === 'tickets');

  const target = editing === 'new' ? null : (ticketsProducts.find((p) => p.id === editing) || null);

  async function save(payload) {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch('/api/admin/tickets/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setEditing(null);
      await onReload();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function del(id) {
    if (!confirm('Delete this product? (Soft-deletes if any sales exist.)')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/tickets/products?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      await onReload();
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {err && (
        <div
          style={{
            color: T.danger,
            margin: '8px 0',
            padding: '8px 12px',
            border: `1px solid ${T.danger}`,
            borderRadius: 8,
            fontSize: 13,
            fontFamily: T.fontStack,
            background: 'rgba(249,112,102,0.08)',
          }}
        >
          {err}
        </div>
      )}

      {editing !== null ? (
        <ProductForm
          eventId={eventId}
          initial={target}
          onSave={save}
          onCancel={() => { setEditing(null); setErr(null); }}
          saving={saving}
          eventFeeDefault={eventFeeDefault}
          eventDate={eventDate}
          eventStartTime={eventStartTime}
        />
      ) : (
        <div style={{ marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className={pillClass('primary')}
            style={primaryPillStyle()}
          >
            + NEW PRODUCT
          </button>
        </div>
      )}

      <table style={tableStyle()}>
        <thead>
          <tr>
            <th style={thStyle()}>Tiers</th>
            <th style={thStyle({ align: 'right' })}>Inventory</th>
            <th style={thStyle()}>Flags</th>
            <th style={thStyle({ align: 'right' })}></th>
          </tr>
        </thead>
        <tbody>
          {ticketsProducts.length === 0 && (
            <tr>
              <td colSpan={4} style={{ ...tdStyle(), color: T.muted, textAlign: 'center' }}>
                No tickets yet. Click &quot;+ NEW PRODUCT&quot; to create your tier ladder.
              </td>
            </tr>
          )}
          {ticketsProducts.map((p) => {
            const active = resolveActiveTier(p.tiers || []);
            const totalTiers = (p.tiers || []).length;
            const hiddenCount = (p.tiers || []).filter((t) => (t.status || 'active') === 'hidden').length;
            const codeGated = (p.tiers || []).filter((t) => (t.status || 'active') === 'access_code').length;
            const soldOutTiers = (p.tiers || []).filter((t) => (t.status || 'active') === 'sold_out').length;
            return (
              <tr key={p.id}>
                <td style={tdStyle()}>
                  <div>{totalTiers} tier{totalTiers === 1 ? '' : 's'}</div>
                  {active && (
                    <div style={{ fontSize: 12, color: T.accent, marginTop: 2 }}>
                      Now: {money(active.price_cents)} — {active.name}
                    </div>
                  )}
                  {(hiddenCount || codeGated || soldOutTiers) ? (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {hiddenCount ? <span style={statusPill({ tone: 'muted' })}>{hiddenCount} hidden</span> : null}
                      {codeGated ? <span style={statusPill({ tone: 'accent' })}>{codeGated} code-gated</span> : null}
                      {soldOutTiers ? <span style={statusPill({ tone: 'warning' })}>{soldOutTiers} sold out</span> : null}
                    </div>
                  ) : null}
                </td>
                <td style={tdStyle({ align: 'right' })}>
                  {(() => {
                    const tiersForRollup = p.tiers || [];
                    const cappedTiers = tiersForRollup.filter((t) => typeof t.quantity === 'number');
                    const anyUnlimited = tiersForRollup.some((t) => typeof t.quantity !== 'number');
                    const totalCap = cappedTiers.reduce((s, t) => s + (t.quantity || 0), 0);
                    const totalSold = tiersForRollup.reduce((s, t) => s + (t.sold_count || 0), 0);
                    const totalReserved = tiersForRollup.reduce((s, t) => s + (t.reserved_count || 0), 0);
                    return (
                      <>
                        <div style={{ fontWeight: 600 }}>
                          {anyUnlimited ? '∞' : totalCap}
                        </div>
                        <div style={{ fontSize: 12, color: T.muted }}>
                          {totalSold} sold · {totalReserved} held
                        </div>
                      </>
                    );
                  })()}
                </td>
                <td style={tdStyle()}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {p.is_active === false && <span style={statusPill({ tone: 'danger' })}>Inactive</span>}
                    {p.member_only && <span style={statusPill({ tone: 'accent' })}>Members</span>}

                  </div>
                </td>
                <td style={tdStyle({ align: 'right' })}>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => setEditing(p.id)}
                      disabled={saving}
                      className={pillClass()}
                      style={ghostPillStyle({ disabled: saving })}
                    >
                      EDIT
                    </button>
                    <button
                      type="button"
                      onClick={() => del(p.id)}
                      disabled={saving}
                      className={pillClass()}
                      style={ghostPillStyle({ disabled: saving, danger: true })}
                    >
                      DELETE
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
