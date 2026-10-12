import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const component = read('app/bananas/membership/MembershipHubClient.js');
const api = read('app/api/admin/membership/journey/route.js');

test('all Journey tabs render the same large-thumbnail list rows', () => {
  assert.match(component, /import styles from '\.\.\/components\/profile-list\.module\.css'/);
  assert.match(component, /<ul className=\{styles\.list\} data-testid="membership-journey-list">/);
  assert.match(component, /filtered\.map\(\(row\) => \(\s*<ProfileRow/s);
  assert.doesNotMatch(component, /cardStyles\.grid|<ProfileCard/);
  assert.match(component, /stageLabel=\{activeMeta\?\.label\}/);
  for (const tab of ['guest', 'trial_ready', 'trial_activated', 'weekender', 'builder', 'insider']) {
    assert.ok(api.includes(`'${tab}'`), `${tab} remains in the API`);
  }
});

test('list photos stay large squares, never circular avatars', () => {
  const css = read('app/bananas/components/profile-list.module.css');
  assert.match(component, /className=\{styles\.photo\}/);
  assert.match(component, /aspectRatio: '1 \/ 1'/);
  assert.match(css, /grid-template-columns: 144px/);
  assert.match(css, /\.photo \{ grid-area: photo; width: 120px; \}/);
  assert.doesNotMatch(component, /rounded-full|function Avatar/);
  assert.match(component, /photoUrl !== failedUrl/);
  assert.match(component, /onError=\{\(\) => \{ setFailedUrl\(photoUrl\); onPhotoError\?\.\(\); \}\}/);
  assert.match(component, /loading="lazy"/);
});

test('tab counts are exact and every source is read past the 1000-row cap', () => {
  const tabs = read('app/bananas/components/UnderlineTabs.js');
  assert.match(component, /testId="membership-journey"\s*exactCounts/);
  assert.match(tabs, /exactCounts \|\| count <= 99 \? count\.toLocaleString\('en-US'\) : '99\+'/);
  assert.doesNotMatch(api, /\.limit\(\d/);
  assert.equal((api.match(/fetchAllRows\(\(from, to\) =>/g) || []).length, 4);
  assert.equal((api.match(/\.order\('id', \{ ascending: true \}\)/g) || []).length, 4);
  assert.match(api, /if \(error\) throw new Error/);
});

test('contact data remains visible on mobile and non-linked records stay read-only', () => {
  assert.match(component, /<dt>Email<\/dt>/);
  assert.match(component, /<dt>Phone<\/dt>/);
  assert.doesNotMatch(component, /hidden md:flex|truncate/);
  assert.match(component, /if \(!row\.href\) return <li><article/);
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
