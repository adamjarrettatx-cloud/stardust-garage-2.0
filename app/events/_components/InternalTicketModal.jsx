'use client';

// Trigger + modal wrapper around InternalTicketPurchase, now with an account
// gate in front of the purchase widget.
//
// The event page shows a single white "BUY TICKETS" pill that matches the
// external TicketTailor flow. Clicking it pops a full-screen dark modal that
// EITHER asks the visitor to create/sign into a Stardust account (if they
// aren't already authenticated) or drops them straight into the purchase
// widget. Successful sign-in seamlessly swaps to the purchase step inside
// the same modal, without a page refresh.
//
// Why the gate lives here (and not on /api/tickets/hold alone):
//   * The API also rejects anonymous callers with 401, but that's a defence-
//     in-depth check for direct callers. The user-facing gate is a modal step
//     so the buyer never sees a checkout form only to be blocked at submit.
//   * Keeping the gate + purchase inside one modal means there's no full-page
//     navigation between "click BUY TICKETS" and "pay", which is important
//     on mobile where redirects lose the buyer to Safari's tab history.
//
// Google OAuth handoff:
//   * AccountGate's Google button hands off to /auth/callback?next=<eventUrl>
//     ?signup=complete. When Google returns the visitor to the event page,
//     our mount effect detects ?signup=complete, opens the modal in the
//     checkout step, and strips the query param so a back-nav doesn't loop.
//
// Modal behaviors:
//   * Esc closes.
//   * Backdrop click closes.
//   * `body` scroll is locked while open so mobile doesn't fight the modal.
//   * Focus lands on the close button on open (keyboard users can Tab into
//     the widget from there).
//   * The whole widget mounts lazily \u2014 availability is only fetched the
//     first time the modal opens, so scrolling the event page doesn't
//     trigger a network round-trip for every visitor who never clicks BUY
//     TICKETS.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import InternalTicketPurchase from './InternalTicketPurchase';
import AccountGate from '@/app/components/AccountGate';

export default function InternalTicketModal({
  eventId,
  eventTitle,
  preview = false,
  isMember = false,
  triggerLabel = 'BUY TICKETS',
}) {
  const [open, setOpen] = useState(false);
  // step: 'gate' \u2014 show AccountGate; 'checkout' \u2014 show InternalTicketPurchase.
  // Resolved on open (and on Google-callback re-entry) from supabase.auth.getUser.
  const [step, setStep] = useState('gate');
  const [checkingAuth, setCheckingAuth] = useState(false);
  const closeButtonRef = useRef(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  const close = useCallback(() => setOpen(false), []);

  // On mount, if we came back from Google OAuth (?signup=complete) and are
  // authenticated, jump straight into checkout inside the modal and strip
  // the query param so back-nav doesn't loop the modal open forever.
  useEffect(() => {
    if (searchParams.get('signup') !== 'complete') return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (data?.user) {
        setStep('checkout');
        setOpen(true);
        // Strip the query param without touching pathname.
        const params = new URLSearchParams(Array.from(searchParams.entries()));
        params.delete('signup');
        const query = params.toString();
        router.replace(query ? `?${query}` : '?', { scroll: false });
      }
    })();
    return () => { cancelled = true; };
    // Only fire on mount — subsequent renders shouldn't re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mobile-app deep-link support: when the app sends the user here with
  // ?buy=1, auto-open the modal on mount so they don't have to tap BUY
  // TICKETS a second time in the in-app browser. Combined with the
  // ?email= param the app already sends, the sign-in prefill is one tap
  // away. Strip ?buy=1 from the URL so back-nav / refresh don't reopen it
  // in an infinite loop.
  useEffect(() => {
    if (searchParams.get('buy') !== '1') return;
    setOpen(true);
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.delete('buy');
    const query = params.toString();
    router.replace(query ? `?${query}` : '?', { scroll: false });
    // Only fire on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Decide gate-vs-checkout every time the modal opens, so a sign-out
  // elsewhere in the tab isn't papered over by stale state.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCheckingAuth(true);
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      setStep(data?.user ? 'checkout' : 'gate');
      setCheckingAuth(false);
    })();
    return () => { cancelled = true; };
  }, [open]);

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
                {'\u00D7'}
              </button>
            </div>

            {checkingAuth ? (
              <div style={{ padding: '32px 0', textAlign: 'center', color: '#8a8a8a', fontSize: 13 }}>
                Loading…
              </div>
            ) : step === 'gate' ? (
              <AccountGate
                // Prefill from ?email= on the URL and default to the Sign In
                // tab when it's present \u2014 the mobile app deep-links here with
                // the currently signed-in user's email so they don't have to
                // retype it in the in-app browser.
                defaultTab={searchParams.get('email') ? 'signin' : 'signup'}
                prefillEmail={searchParams.get('email') || ''}
                headline="Sign in to buy tickets"
                subheadline="Online purchases now require a Stardust account — takes about 15 seconds. All your tickets live in your account."
                onSuccess={() => setStep('checkout')}
              />
            ) : (
              <InternalTicketPurchase
                eventId={eventId}
                preview={preview}
                isMember={isMember}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
