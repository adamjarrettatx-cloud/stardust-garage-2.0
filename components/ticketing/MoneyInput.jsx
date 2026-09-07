'use client';

// MoneyInput — dollars-and-cents input that stores as integer cents.
//
// Why this exists instead of raw <input type="number">:
//
//   1. `type="number"` reacts to the mousewheel when focused. In the admin
//      ticket tier / fee / private-space price fields that meant scrolling
//      the page over a focused amount silently nudged the value by the
//      `step="0.01"` — the "it just scrolls by cents" bug on the events
//      admin edit page. We use `type="text"` + `inputMode="decimal"` so
//      the numeric keypad still shows on mobile, and no wheel handler
//      changes the value.
//
//   2. The original inputs reformatted on every keystroke (cents → dollars
//      via `.toFixed(2)`), which meant typing "25" was replaced with
//      "25.00" mid-keystroke and any further digits landed in the wrong
//      spot. Here we keep a local **string draft** while focused so the
//      user can type "25", "25.", "25.5", ".50" naturally, and we only
//      normalize to canonical dollars on blur.
//
// The value contract stays the same as before: parent gets integer cents
// via onChangeCents(cents | null). We commit on blur *and* on any edit
// that already parses to a valid number, so save-without-blur works too.

import { useEffect, useRef, useState } from 'react';

function centsToDraft(cents) {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return '';
  return (cents / 100).toFixed(2);
}

function draftToCents(v) {
  if (v === '' || v === null || v === undefined) return null;
  // Tolerate a trailing decimal ("25.") or leading decimal (".5") while
  // typing — parseFloat handles both. Reject anything else.
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

// Only allow digits and a single decimal point. Everything else is
// silently stripped so paste of "$25.00" or "25,00" degrades to
// something sensible instead of blocking the field.
function sanitize(raw) {
  const cleaned = String(raw).replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  // Drop any additional dots after the first.
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
}

export default function MoneyInput({
  valueCents,
  onChangeCents,
  placeholder,
  style,
  title,
  disabled,
  allowEmpty = false,
  min = 0,
}) {
  // Local draft: what the user is currently typing. When the field is not
  // focused we mirror the parent's cents value so external updates (reset,
  // load, template apply) show up.
  const [draft, setDraft] = useState(() => centsToDraft(valueCents));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(centsToDraft(valueCents));
    }
  }, [valueCents]);

  function handleChange(e) {
    const next = sanitize(e.target.value);
    setDraft(next);
    // Commit intermediate valid numbers so the parent stays in sync without
    // requiring blur (Save works even if the user clicks straight to it).
    if (next === '') {
      if (allowEmpty) onChangeCents(null);
      return;
    }
    const cents = draftToCents(next);
    if (cents !== null && cents >= min * 100) {
      onChangeCents(cents);
    }
  }

  function handleBlur() {
    focusedRef.current = false;
    if (draft === '') {
      if (allowEmpty) {
        onChangeCents(null);
      } else {
        // Snap back to zero when empty isn't allowed.
        onChangeCents(0);
        setDraft(centsToDraft(0));
      }
      return;
    }
    const cents = draftToCents(draft);
    if (cents === null) {
      // Unparseable — restore last-good value from parent.
      setDraft(centsToDraft(valueCents));
      return;
    }
    const clamped = Math.max(min * 100, cents);
    onChangeCents(clamped);
    setDraft(centsToDraft(clamped));
  }

  function handleFocus(e) {
    focusedRef.current = true;
    // Select the whole draft so typing replaces it, matching how the old
    // number input behaved after tabbing in.
    requestAnimationFrame(() => {
      try { e.target.select(); } catch { /* ignore */ }
    });
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={draft}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
      style={style}
      title={title}
      disabled={disabled}
    />
  );
}
