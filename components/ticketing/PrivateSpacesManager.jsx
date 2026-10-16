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
import MoneyInput from './MoneyInput.jsx';
import { createClient } from '@/lib/supabase/client';
import { uploadEventImage } from '@/lib/event-image-upload';
import { INSIDER_PRIVATE_SPACE_DISCOUNT_PERCENT, insiderPrivateSpacePriceCents } from '@/lib/membership-tiers';
import {
  LEFT_DOOR_DEFAULT_DESCRIPTION,
  LEFT_DOOR_DEFAULT_IMAGE_URL,
  LEFT_DOOR_NAME,
  isLeftDoor,
  leftDoorPriceTier,
  leftDoorState,
} from '@/lib/left-door';

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
//   - Thumbnail            (optional photo of the space, shown to buyers)
//   - Members only / Active toggles
//
// Multiple different spaces per event are supported (rentals for different
// rooms at different prices).
//
// The Left Door (system_key = 'left_door') is permanent: the database adds it
// to every event with the default photo and description but no price. It is
// pinned first, cannot be deleted, sells only once a price is set, and can be
// switched off per event ("Sell at this event").

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
    image_url: null,
    // Private-space rentals are open to everyone by policy (Insider members
    // get 20% off at checkout) — no admin UI toggle. is_active also stays
    // true from this row (retire via delete).
    member_only: false,
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
    image_url: p.image_url || null,
    capacity: p.capacity ?? 1,
    min_per_order: p.min_per_order ?? 1,
    max_per_order: p.max_per_order ?? 1,
    tiers: [firstTier],
  };
}

function SpaceForm({ eventId, initial, onSave, onCancel, saving, leftDoor = false }) {
  const [s, setS] = useState(() => {
    const shape = initial ? toEditShape(initial) : blankSpace(eventId);
    // The Left Door starts without a price; show an empty price box rather
    // than $0.00 so the admin has to type this event's price.
    if (leftDoor && !leftDoorPriceTier(initial)) {
      shape.tiers = [{ ...shape.tiers[0], price_cents: null }];
    }
    return shape;
  });
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState(null);

  async function onPickImage(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) {
      setUploadErr('Please choose an image file.');
      return;
    }
    setUploadErr(null);
    setUploading(true);
    try {
      const { publicUrl, error } = await uploadEventImage(createClient(), file);
      if (error || !publicUrl) throw new Error(error?.message || 'Upload failed');
      setS((prev) => ({ ...prev, image_url: publicUrl }));
    } catch (err) {
      setUploadErr(String(err.message || err));
    } finally {
      setUploading(false);
    }
  }

  const tier = s.tiers[0];
  const nameValid = s.name.trim().length > 0;
  const priceValid = leftDoor
    ? Number.isInteger(tier.price_cents) && tier.price_cents > 0
    : Number.isFinite(tier.price_cents) && tier.price_cents >= 0;
  const canSave = nameValid && priceValid && !saving && !uploading;

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
      image_url: s.image_url || null,
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
    if (leftDoor) {
      payload.name = LEFT_DOOR_NAME;
      payload.capacity = 1;
      payload.min_per_order = 1;
      payload.max_per_order = 1;
    }
    onSave(payload);
  }

  return (
    <div style={{ ...cardStyle({ padding: 20 }), marginBottom: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: leftDoor ? '2fr 1fr' : '2fr 1fr 1fr', gap: 14 }}>
        {leftDoor ? (
          <div>
            <div style={fieldLabelStyle()}>Space</div>
            <div style={{ padding: '9px 0', fontSize: 14, fontWeight: 700, color: T.strongText, fontFamily: T.fontStack }}>
              {LEFT_DOOR_NAME}
              <span style={{ fontWeight: 400, color: T.muted, fontSize: 12 }}> · 1 room per event</span>
            </div>
          </div>
        ) : (
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
        )}
        <label>
          <div style={fieldLabelStyle()}>{leftDoor ? 'Price for this event ($) *' : 'Price ($)'}</div>
          {/* Uses MoneyInput so the mouse wheel can't nudge the value
              while focused (the "scrolls by cents" bug on the events
              admin edit page) and so mid-typing values aren't reformatted
              on every keystroke. Stored as integer cents. */}
          <MoneyInput
            valueCents={tier.price_cents}
            onChangeCents={(c) => setS({ ...s, tiers: [{ ...tier, price_cents: leftDoor ? c : (c ?? 0) }] })}
            style={inputStyle({ invalid: !priceValid && !(leftDoor && tier.price_cents === null) })}
            placeholder={leftDoor ? 'Set price' : '500.00'}
            allowEmpty={leftDoor}
            title="Price ($)"
          />
        </label>
        {!leftDoor && (
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
        )}

        <label style={{ gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <div style={fieldLabelStyle()}>Description</div>
            {leftDoor && s.description !== LEFT_DOOR_DEFAULT_DESCRIPTION && (
              <button
                type="button"
                onClick={() => setS({ ...s, description: LEFT_DOOR_DEFAULT_DESCRIPTION })}
                style={{ background: 'none', border: 0, padding: 0, color: T.muted, fontSize: 11, textDecoration: 'underline', cursor: 'pointer', fontFamily: T.fontStack }}
              >
                Use default
              </button>
            )}
          </div>
          <textarea
            rows={3}
            value={s.description}
            onChange={(e) => setS({ ...s, description: e.target.value })}
            style={{ ...inputStyle(), resize: 'vertical', minHeight: 80 }}
            placeholder="Up to 10 people. Private bar service, dedicated host, separate bathroom."
          />
        </label>

        <div style={{ gridColumn: '1 / -1' }}>
          <div style={fieldLabelStyle()}>Thumbnail</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {s.image_url ? (
              <img
                src={s.image_url}
                alt=""
                style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 8, border: `1px solid ${T.border}`, display: 'block' }}
              />
            ) : (
              <div
                style={{
                  width: 120, height: 90, borderRadius: 8, border: `1px dashed ${T.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, color: T.muted, fontFamily: T.fontStack, background: T.innerBg,
                }}
              >
                No image
              </div>
            )}
            <label
              className={pillClass()}
              style={{ ...ghostPillStyle({ disabled: uploading || saving }), cursor: uploading || saving ? 'not-allowed' : 'pointer' }}
            >
              {uploading ? 'UPLOADING\u2026' : (s.image_url ? 'REPLACE IMAGE' : 'UPLOAD IMAGE')}
              <input
                type="file"
                accept="image/*"
                onChange={onPickImage}
                disabled={uploading || saving}
                style={{ display: 'none' }}
              />
            </label>
            {leftDoor && s.image_url !== LEFT_DOOR_DEFAULT_IMAGE_URL && !uploading && (
              <button
                type="button"
                onClick={() => setS({ ...s, image_url: LEFT_DOOR_DEFAULT_IMAGE_URL })}
                disabled={saving}
                className={pillClass()}
                style={ghostPillStyle({ disabled: saving })}
              >
                USE DEFAULT PHOTO
              </button>
            )}
            {s.image_url && !uploading && (
              <button
                type="button"
                onClick={() => setS({ ...s, image_url: null })}
                disabled={saving}
                className={pillClass()}
                style={ghostPillStyle({ disabled: saving, danger: true })}
              >
                REMOVE
              </button>
            )}
          </div>
          {uploadErr && <div style={{ color: T.danger, fontSize: 12, marginTop: 6 }}>{uploadErr}</div>}
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
          {nameValid
            ? <strong style={{ color: T.strongText }}>{s.name}</strong>
            : <em style={{ color: T.faint }}>(name required)</em>}
          <span style={{ color: T.muted }}> · open to everyone</span>
        </div>
        <div style={{ marginTop: 4 }}>
          Price:{' '}
          <strong style={{ color: T.strongText }}>{Number.isInteger(tier.price_cents) ? money(tier.price_cents) : '—'}</strong>
          {' · '}
          <span style={{ color: T.muted }}>{leftDoor ? 1 : (s.capacity || 1)} available</span>
        </div>
        <div style={{ marginTop: 4 }}>
          Insider members:{' '}
          <strong style={{ color: T.strongText }}>{Number.isInteger(tier.price_cents) ? money(insiderPrivateSpacePriceCents(tier.price_cents)) : '—'}</strong>
          <span style={{ color: T.muted }}> · {INSIDER_PRIVATE_SPACE_DISCOUNT_PERCENT}% off</span>
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
          {saving ? 'SAVING\u2026' : (leftDoor ? 'SAVE THE LEFT DOOR' : (s.id ? 'SAVE SPACE' : 'CREATE SPACE'))}
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
        {nameValid && !priceValid && <span style={{ color: T.danger, fontSize: 12 }}>{leftDoor ? 'Set a price above $0' : 'Valid price required'}</span>}
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
        {p.image_url && (
          <img
            src={p.image_url}
            alt=""
            style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 8, border: `1px solid ${T.border}`, flex: '0 0 auto', display: 'block' }}
          />
        )}
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

      <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
      <div className="sdg-row-icon-group" role="group" aria-label={`Manage ${p.name || 'private space'}`} style={{ opacity: saving ? 0.5 : 1 }}>
        <button
          type="button"
          onClick={onEdit}
          disabled={saving}
          className="sdg-row-icon-btn"
          aria-label={`Edit ${p.name || 'private space'}`}
          title="Edit private space"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M16.9 3.6a2.1 2.1 0 0 1 3 3L8.5 18 4 19.5 5.5 15z" />
            <path d="M14.5 6l3.5 3.5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={saving}
          className="sdg-row-icon-btn sdg-row-icon-btn--danger"
          aria-label={`Delete ${p.name || 'private space'}`}
          title="Delete private space"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18" />
            <path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" />
            <path d="M18.5 6l-.8 13.1A2 2 0 0 1 15.7 21H8.3a2 2 0 0 1-2-1.9L5.5 6" />
            <path d="M10 10.5v6" />
            <path d="M14 10.5v6" />
          </svg>
        </button>
      </div>
      </div>
    </div>
  );
}

// On/off switch used for "Sell at this event".
function SellSwitch({ checked, onChange, disabled }) {
  return (
    <label
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 12, color: T.text, fontFamily: T.fontStack, userSelect: 'none', whiteSpace: 'nowrap',
      }}
    >
      <span style={{ letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600, color: checked ? T.strongText : T.muted }}>
        Sell at this event
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
      />
      <span
        aria-hidden="true"
        style={{
          width: 38, height: 22, borderRadius: 4, position: 'relative', flex: '0 0 auto',
          background: checked ? T.success : 'rgba(255,255,255,0.12)',
          border: `1px solid ${checked ? T.success : T.border}`,
          opacity: disabled ? 0.5 : 1, transition: 'background 120ms',
        }}
      >
        <span
          style={{
            position: 'absolute', top: 2, left: checked ? 18 : 2, width: 16, height: 16, borderRadius: 3,
            background: '#fff', transition: 'left 120ms',
          }}
        />
      </span>
    </label>
  );
}

// Payload that re-saves the Left Door exactly as it is, with overrides.
function leftDoorPayload(p, overrides = {}) {
  return {
    id: p.id,
    event_id: p.event_id,
    kind: 'private_space',
    name: LEFT_DOOR_NAME,
    description: p.description ?? null,
    image_url: p.image_url ?? null,
    member_only: false,
    is_active: p.is_active !== false,
    capacity: 1,
    min_per_order: 1,
    max_per_order: 1,
    display_order: p.display_order ?? 0,
    tier_reveal_threshold: 10,
    sales_start_at: p.sales_start_at ?? null,
    sales_end_at: p.sales_end_at ?? null,
    tiers: (p.tiers || []).map((t) => ({ ...t })),
    ...overrides,
  };
}

// Permanent Left Door card: always first, cannot be deleted.
function LeftDoorCard({ p, eventId, onSave, onEdit, onRestore, saving }) {
  const [priceDraft, setPriceDraft] = useState(null);

  if (!p) {
    return (
      <div style={{ ...cardStyle({ padding: 18 }), marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: T.muted, fontFamily: T.fontStack }}>
          <strong style={{ color: T.strongText }}>{LEFT_DOOR_NAME}</strong> isn't on this event.
        </div>
        <button type="button" onClick={onRestore} disabled={saving} className={pillClass('primary')} style={primaryPillStyle({ disabled: saving })}>
          ADD THE LEFT DOOR
        </button>
      </div>
    );
  }

  const state = leftDoorState(p);
  const on = state !== 'off';
  const tier = leftDoorPriceTier(p);
  const price = tier?.price_cents ?? null;

  function toggle(next) {
    if (!next && (p.sold_count || 0) > 0) {
      if (!confirm('The Left Door is already booked for this event. Turning it off stops new sales; the existing booking stays valid.')) return;
    }
    onSave(leftDoorPayload(p, { is_active: next }));
  }

  function savePrice() {
    if (!(Number.isInteger(priceDraft) && priceDraft > 0)) return;
    const base = tier || {
      id: null, name: 'Rental', currency: 'usd', starts_at: null, ends_at: null,
      is_active: true, display_order: 0, status: 'active', access_codes: null,
      booking_fee_cents_override: null,
    };
    onSave(leftDoorPayload(p, {
      is_active: true,
      tiers: [{ ...base, price_cents: priceDraft, status: 'active', is_active: true }],
    }));
  }

  const statusTag = {
    selling: <span style={statusPill({ tone: 'success' })}>On sale</span>,
    needs_price: <span style={statusPill({ tone: 'warning' })}>Needs price</span>,
    sold: <span style={statusPill({ tone: 'accent' })}>Booked</span>,
    off: <span style={statusPill({ tone: 'muted' })}>Not selling</span>,
  }[state];

  return (
    <div style={{ ...cardStyle({ padding: 18 }), marginBottom: 14, opacity: on ? 1 : 0.8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {on && p.image_url && (
          <img
            src={p.image_url}
            alt=""
            style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 4, border: `1px solid ${T.border}`, flex: '0 0 auto', display: 'block' }}
          />
        )}
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, color: T.strongText, fontSize: 16, fontFamily: T.fontStack }}>{LEFT_DOOR_NAME}</span>
            {statusTag}
          </div>
          {on && p.description && (
            <div style={{ fontSize: 13, color: T.muted, marginTop: 6, whiteSpace: 'pre-wrap' }}>{p.description}</div>
          )}
          {!on && (
            <div style={{ fontSize: 13, color: T.muted, marginTop: 6 }}>
              Hidden from buyers for this event. Photo, description and price are kept.
            </div>
          )}
        </div>
        <SellSwitch checked={on} onChange={toggle} disabled={saving} />
      </div>

      {state === 'needs_price' && (
        <div
          style={{
            marginTop: 14, padding: 12, borderRadius: 4, border: `1px solid rgba(245,158,11,0.4)`,
            background: 'rgba(245,158,11,0.08)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 13, color: T.text, fontFamily: T.fontStack, flex: '1 1 220px' }}>
            Set this event's price to start selling. Buyers don't see the room until then.
          </span>
          <div style={{ width: 130 }}>
            <MoneyInput
              valueCents={priceDraft}
              onChangeCents={setPriceDraft}
              allowEmpty
              placeholder="Price ($)"
              title="Left Door price for this event"
              style={inputStyle()}
            />
          </div>
          <button
            type="button"
            onClick={savePrice}
            disabled={saving || !(Number.isInteger(priceDraft) && priceDraft > 0)}
            className={pillClass('primary')}
            style={primaryPillStyle({ disabled: saving || !(Number.isInteger(priceDraft) && priceDraft > 0) })}
          >
            {saving ? 'SAVING\u2026' : 'SET PRICE'}
          </button>
        </div>
      )}

      {on && (
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: T.fontStack }}>
            {state !== 'needs_price' && (
              <>
                <span style={{ fontSize: 22, fontWeight: 700, color: T.strongText }}>{money(price)}</span>
                <span style={{ fontSize: 12, color: T.muted }}>
                  {' · '}Insider {money(insiderPrivateSpacePriceCents(price))}
                  {' · '}1 room{' · '}{p.sold_count || 0} sold
                </span>
              </>
            )}
          </div>
          <div className="sdg-row-icon-group" role="group" aria-label="Manage The Left Door" style={{ opacity: saving ? 0.5 : 1 }}>
            <button
              type="button"
              onClick={onEdit}
              disabled={saving}
              className="sdg-row-icon-btn"
              aria-label="Edit The Left Door"
              title="Edit photo, description and price"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M16.9 3.6a2.1 2.1 0 0 1 3 3L8.5 18 4 19.5 5.5 15z" />
                <path d="M14.5 6l3.5 3.5" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PrivateSpacesManager({ eventId, products, onReload }) {
  const [editing, setEditing] = useState(null); // null | 'new' | product-id
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const allSpaces = (products || []).filter((p) => p.kind === 'private_space');
  const leftDoor = allSpaces.find(isLeftDoor) || null;
  const spaces = allSpaces.filter((p) => !isLeftDoor(p));
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

  async function restoreLeftDoor() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch('/api/admin/tickets/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ensure_left_door: true, event_id: eventId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not add The Left Door');
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

      {leftDoor && editing === leftDoor.id ? (
        <SpaceForm
          key={leftDoor.id}
          eventId={eventId}
          initial={leftDoor}
          onSave={(payload) => save({ ...payload, is_active: true })}
          onCancel={() => { setEditing(null); setErr(null); }}
          saving={saving}
          leftDoor
        />
      ) : (
        <LeftDoorCard
          p={leftDoor}
          eventId={eventId}
          onSave={save}
          onEdit={() => setEditing(leftDoor.id)}
          onRestore={restoreLeftDoor}
          saving={saving}
        />
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
          }}
          saving={saving}
        />
      )}

      {editing !== 'new' && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className={pillClass()}
            style={ghostPillStyle()}
          >
            + ADD ANOTHER PRIVATE SPACE
          </button>
        </div>
      )}
    </div>
  );
}
