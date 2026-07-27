import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatMembershipDate,
  isPushConfigured,
  membershipPaymentFailedPush,
  membershipPushForTransition,
  sendPush,
  ticketConfirmedPush,
} from '../lib/push.js';

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://iwgfelvbebqbaotkylsw.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

// Swaps in the env + a fake fetch for one call, restoring both afterwards so
// tests stay order-independent.
async function withStubbedFetch(impl, run) {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return impl(url, options);
  };
  Object.assign(process.env, ENV);
  try {
    return { result: await run(), calls };
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
}

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

test('sendPush posts to the send-push function with the service role key', async () => {
  const { result, calls } = await withStubbedFetch(
    () => jsonResponse({ ok: true, sent: 2, recipients: 2 }),
    () =>
      sendPush({
        title: 'Tickets confirmed!',
        body: 'Your tickets are ready.',
        data: { type: 'ticket_confirmed' },
        emails: ['buyer@example.com'],
      })
  );

  assert.deepEqual(result, { ok: true, sent: 2, recipients: 2 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${ENV.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-push`);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    title: 'Tickets confirmed!',
    body: 'Your tickets are ready.',
    data: { type: 'ticket_confirmed' },
    emails: ['buyer@example.com'],
  });
});

test('sendPush maps userIds onto the function\'s user_ids field', async () => {
  const { calls } = await withStubbedFetch(
    () => jsonResponse({ ok: true, sent: 1, recipients: 1 }),
    () => sendPush({ title: 'T', body: 'B', userIds: ['user-1'] })
  );
  assert.deepEqual(JSON.parse(calls[0].options.body), { title: 'T', body: 'B', user_ids: ['user-1'] });
});

// Nobody with a linked account / push token is the common case for ticket
// buyers, and it must not read as a failure to the caller.
test('sendPush returns a no_recipients response as a success', async () => {
  const { result } = await withStubbedFetch(
    () => jsonResponse({ ok: true, sent: 0, reason: 'no_recipients' }),
    () => sendPush({ title: 'T', body: 'B', emails: ['nobody@example.com'] })
  );
  assert.deepEqual(result, { ok: true, sent: 0, reason: 'no_recipients' });
});

// Webhooks must still ack 200, so every failure mode has to resolve to null
// rather than throw.
test('sendPush swallows non-2xx responses and network errors', async () => {
  const failed = await withStubbedFetch(
    () => jsonResponse({ error: 'boom' }, 500),
    () => sendPush({ title: 'T', body: 'B', emails: ['a@example.com'] })
  );
  assert.equal(failed.result, null);

  const threw = await withStubbedFetch(
    () => {
      throw new Error('network down');
    },
    () => sendPush({ title: 'T', body: 'B', emails: ['a@example.com'] })
  );
  assert.equal(threw.result, null);
});

test('sendPush skips the call when unconfigured or missing a message', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return jsonResponse({ ok: true, sent: 0 });
  };
  try {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal(isPushConfigured(), false);
    assert.equal(await sendPush({ title: 'T', body: 'B' }), null);

    Object.assign(process.env, ENV);
    assert.equal(isPushConfigured(), true);
    assert.equal(await sendPush({ body: 'B', emails: ['a@example.com'] }), null);
  } finally {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  }
  assert.equal(called, false);
});

test('ticket confirmation uses the event title when there is one', () => {
  assert.deepEqual(
    ticketConfirmedPush({ orderId: 'or_80206624', eventTitle: 'ANYTHING GOES', email: 'buyer@example.com' }),
    {
      title: 'Tickets confirmed!',
      body: 'Your tickets for ANYTHING GOES are ready in your wallet.',
      data: { type: 'ticket_confirmed', order_id: 'or_80206624' },
      emails: ['buyer@example.com'],
    }
  );
});

test('ticket confirmation falls back to "your event" and needs an email', () => {
  const noTitle = ticketConfirmedPush({ orderId: 'or_1', eventTitle: '  ', email: 'buyer@example.com' });
  assert.equal(noTitle.body, 'Your tickets for your event are ready in your wallet.');
  assert.equal(ticketConfirmedPush({ orderId: 'or_1', eventTitle: 'X', email: null }), null);
});

test('membership dates render in the venue timezone', () => {
  assert.equal(formatMembershipDate('2026-08-01T04:00:00.000Z'), 'July 31, 2026');
  assert.equal(formatMembershipDate(null), null);
  assert.equal(formatMembershipDate('not a date'), null);
});

test('a first activation gets the welcome push', () => {
  const push = membershipPushForTransition({
    email: 'member@example.com',
    previous: { subscription_status: 'pending', cancel_at_period_end: false },
    next: { subscription_status: 'active', cancel_at_period_end: false },
  });
  assert.deepEqual(push, {
    title: 'Welcome to Stardust Garage!',
    body: 'Welcome to Stardust Garage! Your membership is active.',
    data: { type: 'membership_update' },
    emails: ['member@example.com'],
  });
});

// Stripe re-sends customer.subscription.updated on every renewal; an
// already-active member must not be welcomed again.
test('an unchanged active subscription sends nothing', () => {
  assert.equal(
    membershipPushForTransition({
      email: 'member@example.com',
      previous: { subscription_status: 'active', cancel_at_period_end: false },
      next: { subscription_status: 'active', cancel_at_period_end: false },
    }),
    null
  );
});

test('cancel-at-period-end announces the end date once', () => {
  const previous = { subscription_status: 'active', cancel_at_period_end: false };
  const next = {
    subscription_status: 'active',
    cancel_at_period_end: true,
    current_period_end: '2026-09-15T12:00:00.000Z',
  };
  assert.deepEqual(membershipPushForTransition({ email: 'member@example.com', previous, next }), {
    title: 'Membership update',
    body: 'Your membership will end on September 15, 2026.',
    data: { type: 'membership_update' },
    emails: ['member@example.com'],
  });
  // Same flag on the next delivery -> already announced.
  assert.equal(membershipPushForTransition({ email: 'member@example.com', previous: next, next }), null);
});

test('a hard cancellation announces without a resolvable date', () => {
  const push = membershipPushForTransition({
    email: 'member@example.com',
    previous: { subscription_status: 'active' },
    next: { subscription_status: 'cancelled' },
  });
  assert.equal(push.body, 'Your membership is set to end.');
});

// A member who resubscribes while their old plan is still winding down is
// activating, not ending — but they were never told it ended either.
test('reactivation from cancelled sends the welcome push', () => {
  const push = membershipPushForTransition({
    email: 'member@example.com',
    previous: { subscription_status: 'cancelled', cancel_at_period_end: true },
    next: { subscription_status: 'active', cancel_at_period_end: false },
  });
  assert.equal(push.title, 'Welcome to Stardust Garage!');
});

test('transitions and payment failures need an email to target', () => {
  assert.equal(
    membershipPushForTransition({
      email: null,
      previous: { subscription_status: 'pending' },
      next: { subscription_status: 'active' },
    }),
    null
  );
  assert.equal(membershipPaymentFailedPush({ email: null }), null);
});

test('payment failure asks the member to fix billing', () => {
  assert.deepEqual(membershipPaymentFailedPush({ email: 'member@example.com' }), {
    title: 'Payment issue',
    body: 'There was an issue with your membership payment — please update your billing info.',
    data: { type: 'membership_update' },
    emails: ['member@example.com'],
  });
});
