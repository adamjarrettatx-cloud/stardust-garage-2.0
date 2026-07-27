// Server-side push notifications, sent through the already-deployed `send-push`
// Supabase Edge Function (it owns the Expo push tokens and the
// member_profiles.email -> user_id resolution, so callers only need an email).
//
// Called from webhook handlers (TicketTailor orders, Stripe subscriptions),
// which must always ack 2xx: sendPush therefore never throws and returns null
// on failure instead, so a push problem can't make a provider retry a delivery
// that already landed in the database.
//
// The message/transition builders below are pure so the "when do we notify"
// rules are unit-testable without a live edge function (see tests/push.test.mjs).

export function isPushConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// `{ ok: true, sent: 0, reason: 'no_recipients' }` is the expected response for
// most ticket buyers — they bought a ticket without ever installing the app.
// That is a successful call, not an error.
export async function sendPush({ title, body, data, emails, userIds } = {}) {
  if (!isPushConfigured()) {
    console.warn('[push] skipped: SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL not configured');
    return null;
  }
  if (!title || !body) {
    console.warn('[push] skipped: title and body are required');
    return null;
  }

  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ title, body, data, emails, user_ids: userIds }),
    });
    if (!res.ok) {
      console.error('[push] send-push failed', res.status, await res.text());
      return null;
    }
    const result = await res.json();
    if (result?.sent === 0) {
      console.log('[push] no recipients', result?.reason || '', title);
    }
    return result;
  } catch (err) {
    console.error('[push] send-push error', err);
    return null;
  }
}

export function ticketConfirmedPush({ orderId, eventTitle, email }) {
  if (!email) return null;
  const title = typeof eventTitle === 'string' && eventTitle.trim() ? eventTitle.trim() : 'your event';
  return {
    title: 'Tickets confirmed!',
    body: `Your tickets for ${title} are ready in your wallet.`,
    data: { type: 'ticket_confirmed', order_id: orderId },
    emails: [email],
  };
}

// Membership dates are member-facing, so render them in the venue's timezone
// (same convention as the Stripe webhook's todayDateString).
export function formatMembershipDate(iso) {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(parsed));
}

const MEMBERSHIP_DATA = { type: 'membership_update' };

export function membershipPaymentFailedPush({ email }) {
  if (!email) return null;
  return {
    title: 'Payment issue',
    body: 'There was an issue with your membership payment — please update your billing info.',
    data: MEMBERSHIP_DATA,
    emails: [email],
  };
}

// Which membership push (if any) a subscription sync earns, given the
// member_profiles row as it was before the update and the values just written.
// Only transitions notify: Stripe re-sends customer.subscription.updated for
// changes we don't care about (and on every renewal), so comparing old vs new
// is what keeps a member from being told "welcome" once a month.
export function membershipPushForTransition({ email, previous = {}, next = {} } = {}) {
  if (!email) return null;

  const wasActive = previous.subscription_status === 'active';
  const isActive = next.subscription_status === 'active';

  if (isActive && !wasActive && !next.cancel_at_period_end) {
    return {
      title: 'Welcome to Stardust Garage!',
      body: 'Welcome to Stardust Garage! Your membership is active.',
      data: MEMBERSHIP_DATA,
      emails: [email],
    };
  }

  const wasEnding = previous.subscription_status === 'cancelled' || Boolean(previous.cancel_at_period_end);
  const isEnding = next.subscription_status === 'cancelled' || Boolean(next.cancel_at_period_end);
  if (isEnding && !wasEnding) {
    const endsOn = formatMembershipDate(next.current_period_end);
    return {
      title: 'Membership update',
      body: endsOn ? `Your membership will end on ${endsOn}.` : 'Your membership is set to end.',
      data: MEMBERSHIP_DATA,
      emails: [email],
    };
  }

  return null;
}
