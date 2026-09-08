"use client";

// components/waiver/WaiverGate.jsx
//
// Drop-in gate above the submit button on every ticket / RSVP / member-claim
// flow. Renders the full waiver text inline (scroll box) plus an
// unchecked-by-default checkbox with the short label.
//
// Usage:
//   const [waiverState, setWaiverState] = useState(null);
//   <WaiverGate waiver={publicWaiverPayload} onChange={setWaiverState} />
//   <button
//     disabled={!waiverState?.accepted}
//     onClick={() => submit({ ...form, waiver: waiverState })}
//   >
//     Complete Purchase
//   </button>
//
// The parent MUST pass `waiverState` back to the server in the submit body.
// The server re-validates slug/version/hash and 409s if the client rendered
// a stale version.

import { useMemo, useState } from "react";

export function WaiverGate({ waiver, onChange, className = "" }) {
  const [accepted, setAccepted] = useState(false);
  const bodyId = useMemo(
    () => `waiver-body-${waiver.slug}`,
    [waiver.slug]
  );

  function toggle(e) {
    const next = e.target.checked;
    setAccepted(next);
    onChange?.(
      next
        ? {
            accepted: true,
            slug: waiver.slug,
            version: waiver.version,
            bodySha256: waiver.bodySha256,
          }
        : null
    );
  }

  return (
    <section
      aria-labelledby={`${bodyId}-heading`}
      className={
        "rounded-lg border border-neutral-700 bg-neutral-900/60 p-4 text-sm text-neutral-100 " +
        className
      }
      data-waiver-slug={waiver.slug}
      data-waiver-version={waiver.version}
    >
      <h3
        id={`${bodyId}-heading`}
        className="mb-2 text-base font-semibold uppercase tracking-wide"
      >
        Assumption of Risk, Waiver, and Release of Liability
      </h3>

      <div
        id={bodyId}
        className="mb-3 max-h-64 overflow-y-auto rounded border border-neutral-800 bg-black/40 p-3 text-xs leading-relaxed whitespace-pre-wrap"
        // Full text is verbatim from lib/waiver/versions.js — rendered as text
        // (not innerHTML) to avoid any accidental sanitization/formatting drift
        // that would break the hash match server-side.
      >
        {waiver.bodyMarkdown}
      </div>

      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 flex-none cursor-pointer accent-[#e11d48]"
          checked={accepted}
          onChange={toggle}
          // No `required` — we gate the submit button in the parent.
          data-testid="waiver-checkbox"
          aria-describedby={bodyId}
        />
        <span className="text-sm font-medium leading-snug">
          {waiver.checkboxLabel}
        </span>
      </label>

      <p className="mt-2 text-[11px] text-neutral-400">
        Version {waiver.version} · Governed by the laws of the State of Texas ·
        Travis County venue
      </p>
    </section>
  );
}

/**
 * Small helper hook that returns [state, setState, isReady].
 * Parent uses `isReady` to enable/disable the submit button.
 */
export function useWaiverGate() {
  const [state, setState] = useState(null);
  return { state, setState, isReady: !!state?.accepted };
}
