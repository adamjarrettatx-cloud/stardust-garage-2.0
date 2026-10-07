import test from 'node:test';
import assert from 'node:assert/strict';
import { isMetaTrackablePath, hasAppOptOut, META_APP_OPTOUT_COOKIE } from '../lib/meta/policy.js';
import { metaCheckoutMetadata, metaAttributionFromMetadata } from '../lib/meta/attribution.js';
import { buildMetaServerEvent, sha256Normalized, sendMetaServerEvent } from '../lib/meta/capi.js';

function req(headers) {
  return { headers: new Headers(headers) };
}
function withEnv(env, fn) {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  try { return fn(); } finally {
    for (const k of Object.keys(env)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
}

test('public marketing pages are trackable', () => {
  for (const p of ['/home', '/events', '/events/room-on-fire', '/members', '/venue-rental', '/door', '/pass', '/members/apply']) {
    assert.equal(isMetaTrackablePath(p), true, p);
  }
});

test('staff, admin, private and token routes are never trackable', () => {
  for (const p of ['/bananas', '/bananas/events/1', '/admin', '/team/x', '/staff', '/clock', '/capacity/front-desk',
    '/scan', '/portal', '/account/tickets', '/member', '/member/activate', '/login', '/handoff',
    '/g/abc', '/t/CODE', '/pass/tok', '/tickets/status', '/tickets', '/api/x', '/employee', '/auth/callback']) {
    assert.equal(isMetaTrackablePath(p), false, p);
  }
});

test('URLs carrying tokens or identifiers are not trackable', () => {
  assert.equal(isMetaTrackablePath('/events/secret', '?t=sharetoken'), false);
  assert.equal(isMetaTrackablePath('/home', 'mc_eid=abc&mc_cid=1'), false);
  assert.equal(isMetaTrackablePath('/home', '?utm_source=ig&fbclid=x'), true);
});

test('app opt-out cookie is detected', () => {
  assert.equal(hasAppOptOut(`a=1; ${META_APP_OPTOUT_COOKIE}=1`), true);
  assert.equal(hasAppOptOut('a=1'), false);
});

test('checkout metadata is empty when Meta is not configured', () => {
  withEnv({ NEXT_PUBLIC_META_PIXEL_ID: '', META_CAPI_ACCESS_TOKEN: '' }, () => {
    assert.deepEqual(metaCheckoutMetadata(req({ 'user-agent': 'x' })), {});
  });
});

test('checkout metadata honors app, bearer and GPC opt-outs', () => {
  withEnv({ NEXT_PUBLIC_META_PIXEL_ID: '1', META_CAPI_ACCESS_TOKEN: 't' }, () => {
    assert.deepEqual(metaCheckoutMetadata(req({ cookie: `${META_APP_OPTOUT_COOKIE}=1; _fbp=fb.1.2.3` })), { meta_optout: 'app' });
    assert.deepEqual(metaCheckoutMetadata(req({ authorization: 'Bearer abc' })), { meta_optout: 'app' });
    assert.deepEqual(metaCheckoutMetadata(req({ 'sec-gpc': '1' })), { meta_optout: 'gpc' });
    assert.equal(metaAttributionFromMetadata({ meta_optout: 'app' }), null);
  });
});

test('checkout metadata captures match signals without query strings', () => {
  withEnv({ NEXT_PUBLIC_META_PIXEL_ID: '1', META_CAPI_ACCESS_TOKEN: 't' }, () => {
    const md = metaCheckoutMetadata(req({
      cookie: '_fbp=fb.1.111.222; _fbc=fb.1.111.clickid',
      'x-forwarded-for': '203.0.113.9, 10.0.0.1',
      'user-agent': 'UA'.repeat(400),
      referer: 'https://sdgatx.com/events/x?t=secret',
    }));
    assert.equal(md.meta_ok, '1');
    assert.equal(md.meta_ip, '203.0.113.9');
    assert.equal(md.meta_fbp, 'fb.1.111.222');
    assert.equal(md.meta_fbc, 'fb.1.111.clickid');
    assert.equal(md.meta_src, 'https://sdgatx.com/events/x');
    assert.ok(md.meta_ua.length <= 500);
    for (const v of Object.values(md)) assert.equal(typeof v, 'string');
    const a = metaAttributionFromMetadata(md);
    assert.equal(a.fbp, 'fb.1.111.222');
  });
});

test('server event hashes identifiers and never sends them raw', () => {
  const e = buildMetaServerEvent({
    eventName: 'Purchase', eventId: 'ticket_order_1', eventTime: 100,
    attribution: { clientIp: '1.2.3.4', userAgent: 'UA', fbp: 'p', fbc: 'c', sourceUrl: 'https://sdgatx.com/events/x' },
    email: '  Guest@Example.com ', externalId: 'user-1', value: 42.5, currency: 'usd',
    contentIds: ['evt'], contentName: 'Night', contentType: 'product', numItems: 2,
  });
  assert.equal(e.user_data.em[0], sha256Normalized('guest@example.com'));
  assert.ok(!JSON.stringify(e).includes('Guest@Example.com'));
  assert.equal(e.custom_data.currency, 'USD');
  assert.equal(e.custom_data.value, 42.5);
  assert.equal(e.action_source, 'website');
  assert.equal(e.event_id, 'ticket_order_1');
});

test('sender is a no-op without credentials and never throws', async () => {
  await withEnv({ NEXT_PUBLIC_META_PIXEL_ID: '', META_CAPI_ACCESS_TOKEN: '' }, async () => {
    assert.deepEqual(await sendMetaServerEvent({}), { skipped: 'not_configured' });
  });
  const prev = { ...process.env };
  process.env.NEXT_PUBLIC_META_PIXEL_ID = '1';
  process.env.META_CAPI_ACCESS_TOKEN = 't';
  try {
    const r = await sendMetaServerEvent({ event_name: 'Purchase' }, { fetchImpl: async () => { throw new Error('down'); } });
    assert.equal(r.ok, false);
  } finally {
    process.env.NEXT_PUBLIC_META_PIXEL_ID = prev.NEXT_PUBLIC_META_PIXEL_ID || '';
    process.env.META_CAPI_ACCESS_TOKEN = prev.META_CAPI_ACCESS_TOKEN || '';
  }
});
