'use client';
import { useState } from 'react';
import {
  T,
  cardStyle,
  fieldLabelStyle,
  inputStyle,
  pillClass,
  primaryPillStyle,
  ghostPillStyle,
  sectionHeaderStyle,
  sectionSubStyle,
  statusPill,
} from './ticketingTheme.js';

// Admin manager for "private space" rentals attached to an event.
//
// Under the hood these are still rows in ticket_products (kind = 'private_space')
// with a single price tier, so the same order / checkout / inventory pipeline
// applies. The UI is deliberately simpler than the tiered ticket editor:
//
//   - Space name           (e.g. "Outer Space — Green Room")
//   - Description          (free-form, shown to buyers)
//   - Price ($)            (single, no time-based tiers)
//   - Capacity             (usually 1 or 2)
//   - Members only / Active toggles
//
// Multiple different spaces per event are supported (rentals for different
// rooms at different prices).

function money(cents) {
  if (typeof cents !== 'number') return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'usd' }).format(cents / 100);
}
function centsToDollarInput(c) {
  return typeof c === 'number' ? (c / 100).toFixed(2) : '';
}
function dollarInputToCents(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function blankSpace(eventId) {
  return {
    id: null,
    event_id: eventId,
    kind: 'private_space',
    name: '',
    description: '',
    // Private-space rentals are members-only by policy — no admin UI
    // toggle. is_active also stays true from this row (retire via delete).
    member_only: true,
    is_active: true,
    // Rentals are almost always 1 or 2 units. Default to 1.
    capacity: 1,
    // Rentals are usually purchased in packs of 1.
    min_per_order: 1,
    max_per_order: 1,
    display_order: 0,
    // Single tier under the hood \u2014 the "General" price for the space.
    tiers: [
      {
        id: null,
        name: 'Rental',
        price_cents: 50000, // $500 default \u2014 admin will override
        starts_at: null,
        ends_at: null,
        is_active: true,
        display_order: 0,
        status: 'active',
        access_codes: [],
        booking_fee_cents_override: null,
      },
    ],
  };
}

function toEditShape(p) {
  const firstTier = (p.tiers || [])[0] || {
    id: null, name: 'Rental', price_cents: 0, is_active: true,
    status: 'active', display_order: 0, access_codes: [],
    booking_fee_cents_override: null, starts_at: null, ends_at: null,
  };
  return {
    ...p,
    description: p.description || '',
    capacity: p.capacity ?? 1,
    min_per_order: p.min_per_order ?? 1,
    max_per_order: p.max_per_order ?? 1,
    tiers: [firstTier],
  };
}

function SpaceForm({ eventId, initial, onSave, onCancel, saving }) {
  const [s, setS] = useState(() => (initial ? toEditShape(initial) : blankSpace(eventId)));

  const tier = s.tiers[0];
  const nameValid = s.name.trim().length > 0;
  const priceValid = Number.isFinite(tier.price_cents) && tier.price_cents >= 0;
  const canSave = nameValid && priceValid && !saving;

  function setPriceDollars(v) {
    const cents = dollarInputToCents(v);
    setS({
      ...s,
      tiers: [{ ...tier, price_cents: cents ?? 0 }],
    });
  }

  function submit() {
    const payload = {
      ...s,
      name: s.name.trim(),
      description: s.description?.trim() || null,
      kind: 'private_space',
      // Always exactly one tier for a private space.
      tiers: [
        {
          ...tier,
          name: tier.name || 'Rental',
          starts_at: null,
          ends_at: null,
          status: 'active',
          access_codes: null,
          display_order: 0,
        },
      ],
      // Rentals don't use tiered reveal.
      tier_reveal_threshold: 10,
      capacity: s.capacity === '' || s.capacity === null || s.capacity === undefined ? null : Number(s.capacity),
    };
    onSave(payload);
  }

  return (
    <div style={{ ...cardStyle({ padding: 20 }), marginBottom: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 14 }}>
        <label>
          <div style={fieldLabelStyle()}>Space name *</div>
          <input
            type="text"
            value={s.name}
            onChange={(e) => setS({ ...s, name: e.target.value })}
            style={inputStyle({ invalid: !nameValid && s.name.length > 0 })}
            placeholder="Outer Space — Green Room / Upstairs Office"
          />
        </label>
        <label>
          <div style={fieldLabelStyle()}>Price ($)</div>
          <input
            type="number"
            min="0"
            step="0.01"
            value={centsToDollarInput(tier.price_cents)}
            onChange={(e) => setPriceDollars(e.target.value)}
            style={inputStyle({ invalid: !priceValid })}
            placeholder="500.00"
          />
        </label>
        <label>
          <div style={fieldLabelStyle()}>Capacity</div>
          <input
            type="number"
            min="1"
            value={s.capacity ?? ''}
            onChange={(e) => setS({ ...s, capacity: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
            style={inputStyle()}
            placeholder="1"
          />
        </label>

        <label style={{ gridColumn: '1 / -1' }}>
          <div style={fieldLabelStyle()}>Description</div>
          <textarea
            rows={3}
            value={s.description}
            onChange={(e) => setS({ ...s, description: e.target.value })}
            style={{ ...inputStyle(), resize: 'vertical', minHeight: 80 }}
            placeholder="Up to 10 people. Private bar service, dedicated host, separate bathroom."
          />
        </label>

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
          {nameValid
            ? <strong style={{ color: T.strongText }}>{s.name}</strong>
            : <em style={{ color: T.faint }}>(name required)</em>}
          <span style={{ color: T.muted }}> · members only</span>
        </div>
        <div style={{ marginTop: 4 }}>
          Price:{' '}
          <strong style={{ color: T.strongText }}>{money(tier.price_cents)}</strong>
          {' · '}
          <span style={{ color: T.muted }}>{s.capacity || 1} available</span>
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
          {saving ? 'SAVING\u2026' : (s.id ? 'SAVE SPACE' : 'CREATE SPACE')}
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
        {!nameValid && <span style={{ color: T.danger, fontSize: 12 }}>Name required</span>}
        {nameValid && !priceValid && <span style={{ color: T.danger, fontSize: 12 }}>Valid price required</span>}
      </div>
    </div>
  );
}

// Read-only summary card for an existing private-space rental.
function SpaceCard({ p, onEdit, onDelete, saving }) {
  const tier = (p.tiers || [])[0];
  const price = tier ? tier.price_cents : null;
  const remaining =
    typeof p.capacity === 'number'
      ? p.capacity - (p.sold_count || 0) - (p.reserved_count || 0)
      : null;

  return (
    <div style={{ ...cardStyle({ padding: 18 }), marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: T.strongText, fontSize: 16, fontFamily: T.fontStack }}>
            {p.name}
          </div>
          {p.description && (
            <div style={{ fontSize: 13, color: T.muted, marginTop: 6, whiteSpace: 'pre-wrap' }}>
              {p.description}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {p.is_active === false && <span style={statusPill({ tone: 'danger' })}>Inactive</span>}
            {p.member_only && <span style={statusPill({ tone: 'accent' })}>Members</span>}
            {remaining !== null && remaining <= 0 && <span style={statusPill({ tone: 'warning' })}>Sold out</span>}
          </div>
        </div>

        <div style={{ textAlign: 'right', minWidth: 140 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: T.strongText, fontFamily: T.fontStack }}>
            {money(price ?? 0)}
          </div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
            {typeof p.capacity === 'number' ? p.capacity : '∞'} total
            {' · '}
            {p.sold_count || 0} sold
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onEdit}
          disabled={saving}
          className={pillClass()}
          style={ghostPillStyle({ disabled: saving })}
        >
          EDIT
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={saving}
          className={pillClass()}
          style={ghostPillStyle({ disabled: saving, danger: true })}
        >
          DELETE
        </button>
      </div>
    </div>
  );
}

export default function PrivateSpacesManager({ eventId, products, onReload }) {
  const [enabled, setEnabled] = useState(() =>
    (products || []).some((p) => p.kind === 'private_space')
  );
  const [editing, setEditing] = useState(null); // null | 'new' | product-id
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const spaces = (products || []).filter((p) => p.kind === 'private_space');
  const target = editing === 'new' ? null : (spaces.find((p) => p.id === editing) || null);

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
    if (!confirm('Delete this private space? (Soft-deletes if any sales exist.)')) return;
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

  // Not enabled and no existing spaces \u2014 show the "enable" toggle only.
  if (!enabled && spaces.length === 0) {
    return (
      <div>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            background: T.innerBg,
            cursor: 'pointer',
            fontFamily: T.fontStack,
            color: T.text,
          }}
        >
          <input
            type="checkbox"
            checked={false}
            onChange={() => { setEnabled(true); setEditing('new'); }}
            style={{ accentColor: T.accent, width: 16, height: 16 }}
          />
          <span style={{ fontSize: 13 }}>Also sell private space rentals for this event</span>
        </label>
      </div>
    );
  }

  return (
    <div>
      <p style={sectionSubStyle()}>
        Rentable private spaces at this event (e.g. Outer Space — Green Room / Upstairs Office).
        Each has a single price and its own capacity. Buyers pay the space price on top of any ticket they buy.
      </p>

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

      {spaces.map((p) => (
        editing === p.id ? (
          <SpaceForm
            key={p.id}
            eventId={eventId}
            initial={p}
            onSave={save}
            onCancel={() => { setEditing(null); setErr(null); }}
            saving={saving}
          />
        ) : (
          <SpaceCard
            key={p.id}
            p={p}
            onEdit={() => setEditing(p.id)}
            onDelete={() => del(p.id)}
            saving={saving}
          />
        )
      ))}

      {editing === 'new' && (
        <SpaceForm
          eventId={eventId}
          initial={null}
          onSave={save}
          onCancel={() => {
            setEditing(null);
            setErr(null);
            // If they cancelled the very first one, collapse the section back.
            if (spaces.length === 0) setEnabled(false);
          }}
          saving={saving}
        />
      )}

      {editing !== 'new' && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className={pillClass('primary')}
            style={primaryPillStyle()}
          >
            + ADD PRIVATE SPACE
          </button>
        </div>
      )}
    </div>
  );
}
