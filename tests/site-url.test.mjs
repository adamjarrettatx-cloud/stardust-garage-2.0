import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTION_SITE_URL, resolveSiteUrl } from '../lib/site-url.js';

// Stand-in for a Next.js Request: resolveSiteUrl only ever reads headers.
function req(headers = {}) {
  return { headers: { get: (name) => headers[name] ?? null } };
}

test('NEXT_PUBLIC_SITE_URL wins over everything else', () => {
  const url = resolveSiteUrl(req({ origin: 'https://preview.vercel.app' }), {
    NEXT_PUBLIC_SITE_URL: 'https://sdgatx.com',
    VERCEL_ENV: 'preview',
    VERCEL_URL: 'deployment.vercel.app',
  });
  assert.equal(url, 'https://sdgatx.com');
});

test('production resolves to the custom domain, not the deployment hostname', () => {
  const url = resolveSiteUrl(req(), {
    VERCEL_ENV: 'production',
    VERCEL_PROJECT_PRODUCTION_URL: 'sdgatx.com',
    VERCEL_URL: 'stardust-garage-2-0-abc123.vercel.app',
  });
  assert.equal(url, 'https://sdgatx.com');
});

test('production without a known domain still lands on production', () => {
  assert.equal(resolveSiteUrl(req(), { VERCEL_ENV: 'production' }), PRODUCTION_SITE_URL);
});

// The bug this helper exists for: an invite triggered from a preview must not
// mail a production link.
test('preview resolves to the branch deployment, never to production', () => {
  const url = resolveSiteUrl(req(), {
    VERCEL_ENV: 'preview',
    VERCEL_BRANCH_URL: 'stardust-garage-2-0-git-guest-list-partner-invites-sdg.vercel.app',
    VERCEL_URL: 'stardust-garage-2-0-kf3ys3m2u.vercel.app',
  });
  assert.equal(
    url,
    'https://stardust-garage-2-0-git-guest-list-partner-invites-sdg.vercel.app'
  );
});

test('preview falls back to VERCEL_URL when no branch URL is exposed', () => {
  const url = resolveSiteUrl(req(), {
    VERCEL_ENV: 'preview',
    VERCEL_URL: 'stardust-garage-2-0-kf3ys3m2u.vercel.app',
  });
  assert.equal(url, 'https://stardust-garage-2-0-kf3ys3m2u.vercel.app');
});

test('off Vercel, the request origin is used verbatim (localhost keeps http)', () => {
  assert.equal(resolveSiteUrl(req({ origin: 'http://localhost:3000' }), {}), 'http://localhost:3000');
});

// The mobile app sends no Origin header, so this is the path it takes.
test('no env and no origin falls back to production', () => {
  assert.equal(resolveSiteUrl(req(), {}), PRODUCTION_SITE_URL);
  assert.equal(resolveSiteUrl(undefined, {}), PRODUCTION_SITE_URL);
});

test('trailing slashes and bare hostnames are normalized', () => {
  assert.equal(resolveSiteUrl(req(), { NEXT_PUBLIC_SITE_URL: 'https://sdgatx.com/' }), 'https://sdgatx.com');
  assert.equal(resolveSiteUrl(req(), { NEXT_PUBLIC_SITE_URL: 'sdgatx.com' }), 'https://sdgatx.com');
  assert.equal(resolveSiteUrl(req(), { NEXT_PUBLIC_SITE_URL: '   ' , VERCEL_URL: 'x.vercel.app' }), 'https://x.vercel.app');
});
