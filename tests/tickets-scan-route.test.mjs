import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../app/api/tickets/scan/route.js',import.meta.url),'utf8');
test('ticket-only checkin fails closed, including forged override requests',()=>{
  assert.match(source,/if \(mode==='checkin'\) return response/);
  assert.match(source,/code:'guest_pass_required'/);
  assert.doesNotMatch(source,/\.update\(/);
  assert.doesNotMatch(source,/body\.override/);
});
test('staff authentication precedes privileged ticket lookup',()=>{
  assert.ok(source.indexOf('requireFrontDeskOrTeam(request)')<source.indexOf('createAdminClient()'));
  assert.match(source,/validateTicketScan/);
  assert.match(source,/isValidRejectReason/);
});
