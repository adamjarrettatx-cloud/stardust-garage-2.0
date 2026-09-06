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
    return (
      <main style={{ maxWidth: 640, margin: '48px auto', padding: '0 20px' }}>
        <h1>You’re in.</h1>
        <p>We emailed your tickets to <strong>{status.order.buyer_email}</strong>.</p>
        {status.event && (
          <p><a href={`/events/${status.event.slug || status.event.id}`}>Back to {status.event.title}</a></p>
        )}
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
