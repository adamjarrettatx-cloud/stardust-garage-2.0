'use client';

// Trigger + modal wrapper around InternalTicketPurchase.
//
// The event page shows a single white "BUY TICKETS" pill that matches the
// external TicketTailor flow. Clicking it pops a full-screen dark modal
// containing the actual purchase widget so the event page itself stays clean.
//
// Modal behaviors:
//   * Esc closes.
//   * Backdrop click closes.
//   * `body` scroll is locked while open so mobile doesn't fight the modal.
//   * Focus lands on the close button on open (keyboard users can Tab into
//     the widget from there).
//   * The whole widget mounts lazily — availability is only fetched the first
//     time the modal opens, so scrolling the event page doesn't trigger a
//     network round-trip for every visitor who never clicks BUY TICKETS.

import { useCallback, useEffect, useRef, useState } from 'react';
import InternalTicketPurchase from './InternalTicketPurchase';

export default function InternalTicketModal({
  eventId,
  eventTitle,
  preview = false,
  isMember = false,
  buyerEmailPrefill = '',
  triggerLabel = 'BUY TICKETS',
}) {
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);

  // Lock body scroll + wire the Escape key while open. Both must be torn down
  // in the effect cleanup or the page stays frozen after the modal closes.
  useEffect(() => {
    if (!open) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    // Focus the close button on open so keyboard users have a predictable
    // starting point and screen readers announce the modal correctly.
    closeButtonRef.current?.focus?.();
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="order-1 block w-full text-center md:inline-block md:w-auto bg-white text-[#0a0a0a] px-[22px] py-3 md:py-2.5 rounded-full text-[13px] font-bold tracking-[0.08em] mb-8 hover:bg-gray-200 transition-colors"
      >
        {triggerLabel}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={eventTitle ? `Buy tickets: ${eventTitle}` : 'Buy tickets'}
          onClick={close}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            background: 'rgba(0,0,0,0.72)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          {/* Panel. Stops clicks from bubbling to the backdrop so the user
              can select text, click inputs, etc. without dismissing. */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 560,
              maxHeight: '92vh',
              overflowY: 'auto',
              background: '#0a0a0a',
              color: '#f5f5f5',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              border: '1px solid rgba(255,255,255,0.10)',
              padding: '22px 22px 28px',
              boxShadow: '0 -20px 60px rgba(0,0,0,0.6)',
            }}
            className="md:!rounded-[20px] md:!max-h-[86vh]"
          >
            {/* Header. Draggable-looking pill top-center for mobile affordance
                + close button top-right. */}
            <div
              aria-hidden="true"
              style={{
                width: 42,
                height: 4,
                background: 'rgba(255,255,255,0.18)',
                borderRadius: 999,
                margin: '0 auto 14px',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, letterSpacing: '0.14em', fontWeight: 700, color: '#8a8a8a' }}>
                  TICKETS
                </div>
                {eventTitle && (
                  <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {eventTitle}
                  </div>
                )}
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={close}
                aria-label="Close"
                style={{
                  flexShrink: 0,
                  width: 36,
                  height: 36,
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'transparent',
                  color: '#f5f5f5',
                  fontSize: 18,
                  lineHeight: 1,
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>

            <InternalTicketPurchase
              eventId={eventId}
              preview={preview}
              isMember={isMember}
              buyerEmailPrefill={buyerEmailPrefill}
            />
          </div>
        </div>
      )}
    </>
  );
}
