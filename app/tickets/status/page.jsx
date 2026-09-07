import { createClient } from '@supabase/supabase-js';

// /tickets/status?hold=<hold_token>[&cancelled=1]
//
// Return page after a Stripe Checkout redirect. Payment truth lives on the
// webhook, not on this URL — a buyer bookmarking or replaying a success URL
// must never appear "paid" here unless the order row also confirms it. If
// the webhook hasn't landed yet, we show a friendly "confirming" state and
// suggest they'll get an email within a minute.
//
// Server component so we can read via the admin client without exposing
// service-role to the browser.

export const dynamic = 'force-dynamic';

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
    .select('id, title, slug, event_date')
    .eq('id', hold.event_id)
    .maybeSingle();

  return { hold, order, event, state: order?.status === 'paid' ? 'paid' : hold.status };
}

export default async function TicketStatusPage({ searchParams }) {
  const params = await searchParams;
  const holdToken = params?.hold;
  const cancelled = params?.cancelled === '1';

  if (!holdToken || typeof holdToken !== 'string') {
    return (
      <main style={{ maxWidth: 640, margin: '48px auto', padding: '0 20px' }}>
        <h1>Missing checkout reference</h1>
        <p>Please retry from the event page.</p>
      </main>
    );
  }

  const status = await loadStatus(holdToken);

  if (status.state === 'unknown') {
    return (
      <main style={{ maxWidth: 640, margin: '48px auto', padding: '0 20px' }}>
        <h1>Checkout not found</h1>
        <p>This link is expired or invalid. Please restart from the event page.</p>
      </main>
    );
  }

  if (cancelled) {
    return (
      <main style={{ maxWidth: 640, margin: '48px auto', padding: '0 20px' }}>
        <h1>Checkout cancelled</h1>
        <p>No card was charged. Your hold will release automatically.</p>
        {status.event && (
          <p><a href={`/events/${status.event.slug || status.event.id}`}>Back to {status.event.title}</a></p>
        )}
      </main>
    );
  }

  if (status.state === 'paid') {
    // Buttons kept dead-simple inline: we want this page to render even if
    // Tailwind or the design system fails to load on a mobile confirmation
    // return (users often open Stripe on a browser without your CSS in
    // cache yet). Ticket QR codes and check-in codes live on /account/tickets.
    return (
      <main style={{ maxWidth: 640, margin: '48px auto', padding: '0 20px', color: '#f5f5f5' }}>
        <h1 style={{ fontSize: 32, marginBottom: 16 }}>{'You’re in.'}</h1>
        <p style={{ fontSize: 16, lineHeight: 1.55, marginBottom: 12 }}>
          We emailed your tickets to <strong>{status.order.buyer_email}</strong>.
        </p>
        <p style={{ fontSize: 16, lineHeight: 1.55, marginBottom: 28, color: '#c9c9c9' }}>
          {'Each ticket has its own QR code that we’ll scan at the front desk on the night. You can also pull them up any time in your account.'}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 32 }}>
          <a
            href="/account/tickets"
            style={{
              display: 'inline-block',
              padding: '14px 24px',
              borderRadius: 999,
              background: '#ffffff',
              color: '#0a0a0a',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.16em',
            }}
          >
            VIEW MY TICKETS
          </a>
          {status.event && (
            <a
              href={`/events/${status.event.slug || status.event.id}`}
              style={{
                display: 'inline-block',
                padding: '14px 24px',
                borderRadius: 999,
                background: 'transparent',
                color: '#f5f5f5',
                textDecoration: 'none',
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: '0.16em',
                border: '1px solid rgba(255,255,255,0.2)',
              }}
            >
              BACK TO EVENT
            </a>
          )}
        </div>
        <p style={{ fontSize: 13, color: '#8a8a8a', lineHeight: 1.5 }}>
          Tip: save <a href="/account/tickets" style={{ color: '#d9c48c' }}>your account page</a> to your phone home screen so your QR codes are one tap away at the door.
        </p>
      </main>
    );
  }

  // Hold still pending — Stripe redirected the buyer here before the webhook
  // finished. Poll on the client and refresh.
  return (
    <main style={{ maxWidth: 640, margin: '48px auto', padding: '0 20px' }}>
      <h1>Confirming your purchase…</h1>
      <p>Payment was submitted. This usually finishes within a few seconds. Your tickets will arrive by email.</p>
      <script
        dangerouslySetInnerHTML={{
          __html: `setTimeout(function(){ location.reload(); }, 4000);`,
        }}
      />
    </main>
  );
}
