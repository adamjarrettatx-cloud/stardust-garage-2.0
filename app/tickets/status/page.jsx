import { createClient } from '@supabase/supabase-js';

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

async function loadStatus(holdToken) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: hold } = await supabaseAdmin
    .from('ticket_holds')
    .select('id, event_id, status, expires_at, buyer_email, stripe_checkout_session_id')
    .eq('hold_token', holdToken)
    .maybeSingle();
  if (!hold) return { state: 'unknown' };

  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('id, status, buyer_email, event_id')
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

  const status = await loadStatus(holdToken);

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
          <Headline>{'You\u2019re in.'}</Headline>

          <p
            style={{
              fontSize: 16,
              lineHeight: 1.55,
              color: MUTED_STRONG,
              margin: '0 0 28px',
              maxWidth: '38ch',
            }}
          >
            Show your QR code at the front desk. That\u2019s the whole ritual.
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
            <InfoRow label="Ticket sent to" value={status.order.buyer_email} mono />
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
            to your phone\u2019s home screen. Your ticket is one tap away at the door.
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
        <Headline>Confirming\u2026</Headline>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: MUTED_STRONG, margin: '0 0 24px' }}>
          Your payment went through. We\u2019re just waiting on Stripe to hand us the receipt \u2014 usually a couple seconds. This page will refresh itself.
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
