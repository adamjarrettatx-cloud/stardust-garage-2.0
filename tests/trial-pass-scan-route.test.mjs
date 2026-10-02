import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const route=read('app/api/capacity/trial-pass/scan/route.js');
test('trial commit delegates before any rejection writes and has no independent ticket update',()=>{
  assert.ok(route.indexOf('return commitAdmission(admin,')<route.indexOf(".from('trial_pass_checkins').insert"));
  assert.doesNotMatch(route,/\.update\(/);
  assert.match(route,/tokenHash:hashPassToken\(passToken\)/);
});
test('trial preview validates live event and fails closed on lookup failures',()=>{
  for(const token of ['sessionError','dupeError','eventError']) assert.match(route,new RegExp(`if \\(${token}\\) return response`));
  assert.match(route,/evaluateDoorScan/);
  assert.match(route,/alreadyCheckedIn:/);
});
test('trial authentication precedes rate limiting and body parsing',()=>{
  assert.ok(route.indexOf('requireFrontDeskOrTeam(request)')<route.indexOf('const ipLimit'));
  assert.ok(route.indexOf('const credentialLimit')<route.indexOf('request.json()'));
  assert.match(route,/limit: 300, windowMs: 60_000/);
  assert.match(route,/device\.role !== 'front_door'/);
});
test('trial email and activation notification happen only after successful transaction',()=>{
  const helper=read('lib/capacity/commit-admission.ts');
  assert.ok(helper.indexOf('if (!data?.ok)')<helper.indexOf('after(async'));
  const followup=read('lib/capacity/admission-followup.ts');
  assert.match(followup,/application_invite/);
  assert.match(followup,/if \(activated && pass.user_id\)/);
});
