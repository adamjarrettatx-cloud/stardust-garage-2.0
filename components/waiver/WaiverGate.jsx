"use client";

// components/waiver/WaiverGate.jsx
//
// Clickwrap waiver gate. Renders a single checkbox with three inline links
// to the current active waiver at its stable canonical URL (/legal/waiver).
// Clicking any link opens the full waiver in a modal overlay so the buyer
// never leaves the checkout flow.
//
// Enforceability model (Texas):
//   * Reasonable notice        — checkbox label names the document by title
//   * Meaningful assent        — unchecked by default, gates the buy button
//   * Full text one click away — modal opens on demand, full text at
//                                /legal/waiver (stable public URL)
//   * Immutable evidence       — server re-validates slug + version + hash
//                                on submit, stores IP + UA + timestamp
//
// Emitted state (unchanged from the previous in-line version, so the parent
// contract and server-side validator do not need any changes):
//   { accepted: true, slug, version, bodySha256 }  when checked
//   null                                            when unchecked
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

import { useCallback, useEffect, useState } from "react";

const WAIVER_URL = "/legal/waiver";

export function WaiverGate({ waiver, onChange, className = "" }) {
  const [accepted, setAccepted] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

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

  const openModal = useCallback((e) => {
    e?.preventDefault?.();
    setModalOpen(true);
  }, []);

  return (
    <section
      className={
        "rounded-lg border border-neutral-700 bg-neutral-900/60 p-4 text-sm text-neutral-100 " +
        className
      }
      data-waiver-slug={waiver.slug}
      data-waiver-version={waiver.version}
    >
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 flex-none cursor-pointer accent-[#e11d48]"
          checked={accepted}
          onChange={toggle}
          data-testid="waiver-checkbox"
        />
        <span className="text-sm leading-snug">
          I have read and agree to the{" "}
          <a
            href={WAIVER_URL}
            onClick={openModal}
            className="font-medium underline decoration-neutral-500 underline-offset-2 hover:decoration-white"
          >
            Assumption of Risk, Waiver, and Release of Liability
          </a>
          , the{" "}
          <a
            href={`${WAIVER_URL}#7-photography-video-and-recording-release`}
            onClick={openModal}
            className="font-medium underline decoration-neutral-500 underline-offset-2 hover:decoration-white"
          >
            Photo/Video Release
          </a>
          , and the{" "}
          <a
            href={`${WAIVER_URL}#8-no-refund-event-changes-force-majeure`}
            onClick={openModal}
            className="font-medium underline decoration-neutral-500 underline-offset-2 hover:decoration-white"
          >
            No-Refund Policy
          </a>
          . I am 18 or older.
        </span>
      </label>

      <p className="mt-2 pl-8 text-[11px] text-neutral-400">
        Version {waiver.version} · Governed by the laws of the State of Texas ·
        Travis County venue
      </p>

      {modalOpen && (
        <WaiverModal
          waiver={waiver}
          onClose={() => setModalOpen(false)}
        />
      )}
    </section>
  );
}

// --------------------------------------------------------------------------
// Modal — full waiver rendered from the same source string that produced
// the hash, so what the buyer reads is bit-for-bit what the server
// validates against.
// --------------------------------------------------------------------------

function WaiverModal({ waiver, onClose }) {
  // Close on Escape and lock body scroll while open.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="waiver-modal-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          position: "relative",
          background: "#0f0f0f",
          border: "1px solid #2a2a2a",
          borderRadius: 12,
          maxWidth: 780,
          width: "100%",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          color: "#ffffff",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            padding: "20px 24px",
            borderBottom: "1px solid #2a2a2a",
            gap: 16,
          }}
        >
          <div>
            <h2
              id="waiver-modal-title"
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: "#fff",
              }}
            >
              Assumption of Risk, Waiver, and Release of Liability
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8a8a8a" }}>
              Version {waiver.version} · {waiver.slug} · effective {" "}
              {waiver.effectiveAt || "current"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close waiver"
            style={{
              background: "transparent",
              border: "1px solid #2a2a2a",
              borderRadius: 6,
              color: "#ffffff",
              cursor: "pointer",
              padding: "6px 10px",
              fontSize: 13,
              flex: "none",
            }}
          >
            Close
          </button>
        </header>

        <div
          style={{
            padding: "20px 24px",
            overflowY: "auto",
            fontSize: 13,
            lineHeight: 1.65,
            whiteSpace: "pre-wrap",
          }}
        >
          {/*
            Rendered as plain text (whitespace preserved) rather than
            innerHTML so no accidental sanitization or formatting drift
            can break the byte-for-byte match with body_sha256 that the
            server validates on submit.
          */}
          {waiver.bodyMarkdown}
        </div>

        <footer
          style={{
            padding: "12px 24px",
            borderTop: "1px solid #2a2a2a",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 11,
            color: "#8a8a8a",
            gap: 16,
          }}
        >
          <a
            href={WAIVER_URL}
            target="_blank"
            rel="noopener"
            style={{ color: "#b8b8b8", textDecoration: "underline" }}
          >
            Open full page ({WAIVER_URL})
          </a>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "#fff",
              color: "#000",
              border: 0,
              borderRadius: 6,
              padding: "8px 16px",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Done
          </button>
        </footer>
      </div>
    </div>
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
