import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const content = JSON.parse(read('lib/customer-content.json'));
test('website and public endpoint consume one membership catalog', () => {
  for (const file of ['app/members/page.js', 'app/members/apply/[plan]/page.js', 'app/api/public/customer-content/route.js']) {
    assert.match(read(file), /customer-content\.json/);
  }
  assert.doesNotMatch(read('app/members/page.js'), /const plans = \[/);
  assert.doesNotMatch(read('app/members/apply/[plan]/page.js'), /const VALID_PLANS/);
});
test('public contract contains only display information and preserves current offer', () => {
  assert.equal(content.schemaVersion, 1);
  assert.deepEqual(content.membership.plans.map(plan => [plan.key, plan.slug, plan.price]),
    [['weekender', 'weekender', '$48'], ['cowork', 'cowork', '$155'], ['iykyk', 'cowork-party', '$225']]);
  assert.ok(content.membership.plans[2].benefits.includes('Up to 60% off SDG event tickets'));
  assert.equal(content.membership.plans.filter(plan => plan.benefits.some(benefit => benefit.startsWith('20% off weeknight'))).length, 3);
  assert.doesNotMatch(read('app/api/public/customer-content/route.js'), /supabase|stripe|service_role|Authorization/);
  assert.match(read('app/api/public/customer-content/route.js'), /Cache-Control': 'no-store'/);
});
