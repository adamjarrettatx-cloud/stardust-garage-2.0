import { createClient } from '@supabase/supabase-js';
import { createClient as createServerSupabaseClient } from '@/lib/supabase/server';

// /tickets/status?hold=<hold_token>[&cancelled=1]
//
// Post-Stripe-Checkout return page. Payment truth lives on the Stripe webhook,
// not the URL — a buyer bookmarking or replaying a success URL must never
// appear "paid" here unless the order row confirms it. If the webhook hasn't
// landed yet, we show a friendly "confirming" state that polls automatically.
//
// Rendered server-side so we can read via the admin client without exposing
// the service-role key to the browser.
//
// SECURITY (H-04): This page is OWNER-ONLY. A hold_token is a randomly
// generated string but it appears in Stripe redirect URLs, browser history,
// and Referer headers along its way. Before this gate, anyone with a
// hold_token could pull the buyer's email off the order. Now:
//   1. The caller must be signed in (else redirect to /login).
//   2. The signed-in user must own the hold (hold.user_id === user.id) OR
//      be a team member (door staff need to help resolve pending orders).
//   3. The rendered card never prints buyer_email — we show "tickets are
//      in your account" instead, since the owner already knows their
//      own email and the door doesn't need it here.
//
// Visual style: matches the rest of sdgatx.com — deep-black background,
// Moshra Aesthetic display serif for the headline, hairline card, gold accent
// (#d9c48c) reserved for the single "your account" link that reinforces the
// primary long-term action (open the wallet on your phone). Buttons and text
// are inline-styled on purpose — this page can render immediately after a
// Stripe redirect, before Tailwind/CSS hydrates in some mobile browsers.

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Shared design tokens. Kept in one place so every state renders as a variant
// of the same card instead of drifting apart.
// ---------------------------------------------------------------------------
const BG = '#0a0a0a';
const CARD_BG = '#141414';
const HAIRLINE = 'rgba(255,255,255,0.08)';
const HAIRLINE_STRONG = 'rgba(255,255,255,0.14)';
const TEXT = '#f5f5f5';
const MUTED = '#8a8a8a';
const MUTED_STRONG = '#c9c9c9';
const GOLD = '#d9c48c';
const SERIF = "'Moshra Aesthetic', 'Cormorant Unicase', 'Cormorant Garamond', serif";
const SANS = "'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatEventDate(dateStr) {
  if (!dateStr) return null;
  // event_date is a plain YYYY-MM-DD; parse as local so we don't get UTC drift.
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

async function loadStatus(holdToken, currentUserId) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // NOTE: buyer_email is intentionally NOT selected. See H-04 above.
  const { data: hold } = await supabaseAdmin
    .from('ticket_holds')
    .select('id, event_id, status, expires_at, user_id, stripe_checkout_session_id')
    .eq('hold_token', holdToken)
    .maybeSingle();
  if (!hold) return { state: 'unknown' };

  // SECURITY (H-04) owner gate: the signed-in user must own the hold OR
  // be a team member (door staff resolving a pending order). Any other
  // signed-in user gets the same "unknown" state as an anonymous caller,
  // so we don't confirm the hold_token even exists.
  const isOwner = hold.user_id && hold.user_id === currentUserId;
  if (!isOwner) {
    const { data: teamRow } = await supabaseAdmin
      .from('team_members')
      .select('id')
      .eq('user_id', currentUserId)
      .maybeSingle();
    if (!teamRow) return { state: 'unknown' };
  }

  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('id, status, event_id')
    .eq('hold_id', hold.id)
    .maybeSingle();

  const { data: event } = await supabaseAdmin
    .from('events')
    .select('id, title, slug, event_date, event_time')
    .eq('id', hold.event_id)
    .maybeSingle();

  return { hold, order, event, state: order?.status === 'paid' ? 'paid' : hold.status };
}

// ---------------------------------------------------------------------------
// Layout primitives — small, private, kept in this file so the page renders
// atomically on the Stripe return without waiting for any component chunk.
// ---------------------------------------------------------------------------
function PageShell({ children }) {
  return (
    <main
      style={{
        minHeight: 'calc(100vh - 80px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '64px 20px 96px',
        background: BG,
        color: TEXT,
        fontFamily: SANS,
      }}
    >
      <div style={{ width: '100%', maxWidth: 560 }}>{children}</div>
    </main>
  );
}

function Card({ children, accent }) {
  // Thin top accent bar — an unobtrusive brand signal that separates the card
  // from the surrounding starfield without adding chrome.
  return (
    <div
      style={{
        position: 'relative',
        background: CARD_BG,
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 20,
        padding: '40px 32px 36px',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: accent === 'error'
            ? 'linear-gradient(90deg, transparent 0%, rgba(255,120,120,0.9) 50%, transparent 100%)'
            : accent === 'muted'
              ? 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 50%, transparent 100%)'
              : `linear-gradient(90deg, transparent 0%, ${GOLD} 50%, transparent 100%)`,
        }}
      />
      {children}
    </div>
  );
}

function Eyebrow({ children }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: MUTED,
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

function Headline({ children }) {
  return (
    <h1
      style={{
        fontFamily: SERIF,
        fontSize: 'clamp(52px, 9vw, 72px)',
        lineHeight: 0.95,
        letterSpacing: '-0.02em',
        margin: '0 0 28px',
        color: TEXT,
        fontWeight: 400,
      }}
    >
      {children}
    </h1>
  );
}

function InfoRow({ label, value, mono }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 16,
        padding: '14px 0',
        borderTop: `1px solid ${HAIRLINE}`,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: MUTED,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: TEXT,
          textAlign: 'right',
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : SANS,
          wordBreak: mono ? 'break-all' : 'normal',
          lineHeight: 1.4,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function PrimaryButton({ href, children }) {
  return (
    <a
      href={href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '15px 28px',
        borderRadius: 999,
        background: TEXT,
        color: '#0a0a0a',
        textDecoration: 'none',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        transition: 'transform .15s ease, background .15s ease',
      }}
    >
      {children}
    </a>
  );
}

function GhostButton({ href, children }) {
  return (
    <a
      href={href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '15px 28px',
        borderRadius: 999,
        background: 'transparent',
        color: TEXT,
        textDecoration: 'none',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        border: `1px solid ${HAIRLINE_STRONG}`,
      }}
    >
      {children}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default async function TicketStatusPage({ searchParams }) {
  const params = await searchParams;
  const holdToken = params?.hold;
  const cancelled = params?.cancelled === '1';

  // SECURITY (H-04): auth gate BEFORE we touch the hold. Anonymous callers
  // are sent to /login with a return_to back here so the flow resumes
  // after sign-in. Signed-in-but-not-owner is handled inside loadStatus
  // (returns state:'unknown' — same as a bad token, no leak).
  let currentUserId = null;
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    currentUserId = user?.id ?? null;
  } catch {
    currentUserId = null;
  }
  if (!currentUserId && holdToken) {
    // Bounce to sign-in. We URI-encode the hold-only path so ?hold=… is
    // preserved but no other client params.
    const returnTo = `/tickets/status?hold=${encodeURIComponent(String(holdToken))}${cancelled ? '&cancelled=1' : ''}`;
    return (
      <PageShell>
        <Card accent="muted">
          <Eyebrow>Sign in to view</Eyebrow>
          <Headline>Almost there.</Headline>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: MUTED_STRONG, margin: '0 0 32px' }}>
            Sign in with the Stardust account you used at checkout and we’ll pull up your order.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <PrimaryButton href={`/login?next=${encodeURIComponent(returnTo)}`}>Sign in</PrimaryButton>
          </div>
        </Card>
      </PageShell>
    );
  }

  // -------------------------------------------------------------------------
  // Missing / malformed hold token — usually a stale bookmark or someone
  // navigating here directly. Show a friendly redirect back to /events.
  // -------------------------------------------------------------------------
  if (!holdToken || typeof holdToken !== 'string') {
    return (
      <PageShell>
        <Card accent="muted">
          <Eyebrow>No checkout reference</Eyebrow>
          <Headline>Nothing to see here.</Headline>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: MUTED_STRONG, margin: '0 0 32px' }}>
            This page is for confirming a ticket purchase. Head back to the calendar and pick a night.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <PrimaryButton href="/events">Browse events</PrimaryButton>
          </div>
        </Card>
      </PageShell>
    );
  }

  const status = await loadStatus(holdToken, currentUserId);

  // -------------------------------------------------------------------------
  // Hold record missing — expired or tampered token. Same treatment as above
  // but slightly more explicit about the "expired" possibility.
  // -------------------------------------------------------------------------
  if (status.state === 'unknown') {
    return (
      <PageShell>
        <Card accent="muted">
          <Eyebrow>Checkout not found</Eyebrow>
          <Headline>This link expired.</Headline>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: MUTED_STRONG, margin: '0 0 32px' }}>
            Ticket holds only live for a few minutes. If you meant to complete this purchase, restart from the event page and we'll spin up a fresh checkout.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <PrimaryButton href="/events">Back to events</PrimaryButton>
          </div>
        </Card>
      </PageShell>
    );
  }

  // -------------------------------------------------------------------------
  // Cancelled — user hit Back or bailed on Stripe. No charge, hold auto-
  // releases. Route them back to the event so they can retry frictionlessly.
  // -------------------------------------------------------------------------
  if (cancelled) {
    return (
      <PageShell>
        <Card accent="muted">
          <Eyebrow>Checkout cancelled</Eyebrow>
          <Headline>No worries.</Headline>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: MUTED_STRONG, margin: '0 0 32px' }}>
            No card was charged. Your seat hold will release itself in a minute so nothing's stuck. Come back when you're ready.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {status.event && (
              <PrimaryButton href={`/events/${status.event.slug || status.event.id}`}>
                Back to {status.event.title}
              </PrimaryButton>
            )}
            <GhostButton href="/events">All events</GhostButton>
          </div>
        </Card>
      </PageShell>
    );
  }

  // -------------------------------------------------------------------------
  // Paid — the happy path. Show a branded confirmation card with the event
  // context (so the buyer trusts they bought the right thing), the email the
  // tickets went to, and the two follow-up actions: view tickets, back to
  // event. Ticket QR codes and check-in codes live on /account/tickets.
  // -------------------------------------------------------------------------
  if (status.state === 'paid') {
    const eventDate = status.event ? formatEventDate(status.event.event_date) : null;
    const eventTime = status.event?.event_time || null;
    const dateLine = eventDate && eventTime ? `${eventDate} · ${eventTime}` : (eventDate || eventTime || null);

    return (
      <PageShell>
        <Card accent="gold">
          <Eyebrow>Confirmed</Eyebrow>
          <Headline>You’re in.</Headline>

          <p
            style={{
              fontSize: 16,
              lineHeight: 1.55,
              color: MUTED_STRONG,
              margin: '0 0 28px',
            }}
          >
            Each ticket has its own QR code that we’ll scan at the front desk on the night. You can also pull them up any time in your account.
          </p>

          {/* Info block — event / date / email. Uses hairline dividers so it
              reads as a receipt without shouting like a table. */}
          <div style={{ marginBottom: 32, borderBottom: `1px solid ${HAIRLINE}` }}>
            {status.event && (
              <InfoRow label="Event" value={status.event.title} />
            )}
            {dateLine && (
              <InfoRow label="Date" value={dateLine} />
            )}
            {/* H-04: we no longer render buyer_email here — the owner
                already knows their own email, and this page is public-URL
                enough (Stripe redirect, browser history) that PII should
                not appear on it. The wallet at /account/tickets shows
                everything they need. */}
            <InfoRow label="Tickets" value="Waiting in your Stardust account" />
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 32 }}>
            <PrimaryButton href="/account/tickets">View my tickets</PrimaryButton>
            {status.event && (
              <GhostButton href={`/events/${status.event.slug || status.event.id}`}>
                Back to event
              </GhostButton>
            )}
          </div>

          <p
            style={{
              fontSize: 12,
              lineHeight: 1.55,
              color: MUTED,
              margin: 0,
              paddingTop: 20,
              borderTop: `1px solid ${HAIRLINE}`,
              letterSpacing: '0.01em',
            }}
          >
            Pro tip: save{' '}
            <a
              href="/account/tickets"
              style={{ color: GOLD, textDecoration: 'none', borderBottom: `1px solid ${GOLD}`, paddingBottom: 1 }}
            >
              your account
            </a>{' '}
            to your phone’s home screen. Your ticket is one tap away at the door.
          </p>
        </Card>
      </PageShell>
    );
  }

  // -------------------------------------------------------------------------
  // Pending — Stripe redirected us before the webhook landed. Auto-refresh
  // every 3s and let the buyer know their receipt is coming. We keep the copy
  // reassuring; most webhooks complete inside 2 seconds so the first refresh
  // usually flips this to "paid".
  // -------------------------------------------------------------------------
  return (
    <PageShell>
      <Card accent="gold">
        <Eyebrow>Almost there</Eyebrow>
        <Headline>Confirming…</Headline>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: MUTED_STRONG, margin: '0 0 24px' }}>
          Your payment went through. We’re just waiting on Stripe to hand us the receipt — usually a couple seconds. This page will refresh itself.
        </p>
        <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>
          If it stalls for more than a minute, check your email for the confirmation or ping the front desk.
        </p>
        <script
          dangerouslySetInnerHTML={{
            __html: `setTimeout(function(){ location.reload(); }, 3500);`,
          }}
        />
      </Card>
    </PageShell>
  );
}
