import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const component = read('app/bananas/membership/MembershipHubClient.js');
const api = read('app/api/admin/membership/journey/route.js');

test('all Journey tabs render the same application-style card grid', () => {
  assert.match(component, /import cardStyles from '\.\.\/applications\/applications\.module\.css'/);
  assert.match(component, /className=\{cardStyles\.grid\}/);
  assert.match(component, /filtered\.map\(\(row\) => \(\s*<ProfileCard/s);
  assert.match(component, /stageLabel=\{activeMeta\?\.label\}/);
  for (const tab of ['guest', 'trial_ready', 'trial_activated', 'weekender', 'builder', 'insider']) {
    assert.ok(api.includes(`'${tab}'`), `${tab} remains in the API`);
  }
});

test('photos and initials occupy square top panels, never circular avatars', () => {
  assert.match(component, /className=\{cardStyles\.photo\}/);
  assert.match(component, /aspectRatio: '1 \/ 1'/);
  assert.doesNotMatch(component, /rounded-full|function Avatar/);
  assert.match(component, /photoUrl !== failedUrl/);
  assert.match(component, /onError=\{\(\) => \{ setFailedUrl\(photoUrl\); onPhotoError\?\.\(\); \}\}/);
  assert.match(component, /loading="lazy"/);
});

test('contact data remains visible on mobile and non-linked records stay read-only', () => {
  assert.match(component, /<dt>Email<\/dt>/);
  assert.match(component, /<dt>Phone<\/dt>/);
  assert.doesNotMatch(component, /hidden md:flex|truncate/);
  assert.match(component, /if \(!row\.href\) return <article/);
  assert.match(component, /<Link href=\{row\.href\}/);
  assert.match(component, /contextLine\(row\)/);
});

test('search, lifecycle data, MRR and list refresh remain intact', () => {
  assert.match(component, /aria-label="Search name, email or phone"/);
  assert.match(component, /hay\.includes\(query\)/);
  assert.match(component, /useEffect\(\(\) => \{ setQ\(''\); \}, \[active\]\)/);
  assert.match(component, /Monthly recurring/);
  assert.match(component, /fmtCents\(activeMrr\)/);
  assert.match(component, /row\.phone_verified/);
  assert.match(component, /row\.visits/);
  assert.match(component, /row\.monthly_cents/);
  assert.match(component, /window\.setInterval\(refresh, 4 \* 60 \* 1000\)/);
  assert.match(component, /removeEventListener\('visibilitychange', refresh\)/);
  assert.match(api, /await requireOwner\(\)/);
});

test('photos load on demand for visible cards instead of blocking the list', () => {
  // List endpoint: no signing, only a has_photo flag per row.
  assert.doesNotMatch(api, /resolveMemberPhotoUrls|createSignedUrl/);
  assert.match(api, /has_photo: Boolean\(photo_path \|\| photo_url\)/);
  // Client: one shared IntersectionObserver, batched POSTs, cached links.
  assert.match(component, /new IntersectionObserver\(/);
  assert.match(component, /rootMargin: PHOTO_PRELOAD_MARGIN/);
  assert.match(component, /fetch\('\/api\/admin\/membership\/journey\/photos', \{\s*method: 'POST'/);
  assert.match(component, /const PHOTO_BATCH_MAX = 200;/);
  assert.match(component, /cached\.expiresAt - PHOTO_EXPIRY_MARGIN_MS > now/);
  assert.match(component, /row\.has_photo \? callbacksFor\(photoKey\(row\)\)\.ref : undefined/);
});
