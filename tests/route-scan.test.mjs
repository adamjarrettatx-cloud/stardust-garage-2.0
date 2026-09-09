import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planScanAttempts, shouldFallThroughAmbiguous } from '../lib/scan/route-scan.js';

test('planScanAttempts returns empty for unknown', () => {
  const plan = planScanAttempts({ kind: 'unknown' });
  assert.equal(plan.kind, 'unknown');
  assert.deepEqual(plan.attempts, []);
});

test('planScanAttempts returns empty for null / bad input', () => {
  assert.deepEqual(planScanAttempts(null).attempts, []);
  assert.deepEqual(planScanAttempts(undefined).attempts, []);
  assert.deepEqual(planScanAttempts('nope').attempts, []);
});

test('planScanAttempts routes a member_id sniff to /api/scan/member-id', () => {
  const plan = planScanAttempts({ kind: 'member_id', token: 'abc' });
  assert.equal(plan.kind, 'member_id');
  assert.equal(plan.attempts.length, 1);
  assert.equal(plan.attempts[0].source, 'member_id');
  assert.equal(plan.attempts[0].endpoint, '/api/scan/member-id');
  assert.deepEqual(plan.attempts[0].body, { token: 'abc', mode: 'preview' });
});

test('planScanAttempts routes a trial_pass sniff to /api/capacity/trial-pass/scan', () => {
  const plan = planScanAttempts({ kind: 'trial_pass', token: 'xyz' });
  assert.equal(plan.kind, 'trial_pass');
  assert.equal(plan.attempts.length, 1);
  assert.equal(plan.attempts[0].source, 'trial_pass');
  assert.equal(plan.attempts[0].endpoint, '/api/capacity/trial-pass/scan');
});

test('planScanAttempts routes a ticket sniff to /api/tickets/scan', () => {
  const plan = planScanAttempts({ kind: 'ticket', code: 'ABC-123' });
  assert.equal(plan.kind, 'ticket');
  assert.equal(plan.attempts.length, 1);
  assert.equal(plan.attempts[0].endpoint, '/api/tickets/scan');
  assert.deepEqual(plan.attempts[0].body, { code: 'ABC-123', mode: 'preview' });
});

test('planScanAttempts queues member first, trial-pass second for ambiguous_token', () => {
  const plan = planScanAttempts({ kind: 'ambiguous_token', token: 'deadbeef' });
  assert.equal(plan.kind, 'ambiguous_token');
  assert.equal(plan.attempts.length, 2);
  assert.equal(plan.attempts[0].source, 'member_id');
  assert.equal(plan.attempts[1].source, 'trial_pass');
  assert.equal(plan.attempts[0].body.token, 'deadbeef');
  assert.equal(plan.attempts[1].body.token, 'deadbeef');
});

test('shouldFallThroughAmbiguous: member 404 falls through', () => {
  assert.equal(
    shouldFallThroughAmbiguous({ source: 'member_id', status: 404, json: { error: 'Unknown Member ID' } }),
    true,
  );
});

test('shouldFallThroughAmbiguous: member 200 does not', () => {
  assert.equal(
    shouldFallThroughAmbiguous({ source: 'member_id', status: 200, json: { mode: 'preview', member: {} } }),
    false,
  );
});

test('shouldFallThroughAmbiguous: revoked member (410) does not fall through', () => {
  // A revoked badge must render, not be silently retried as a trial pass \u2014
  // that would let a revoked person walk in on a leaked trial-pass row.
  assert.equal(
    shouldFallThroughAmbiguous({ source: 'member_id', status: 410, json: { error: 'revoked' } }),
    false,
  );
});

test('shouldFallThroughAmbiguous: member 429 does not fall through (rate limited)', () => {
  assert.equal(
    shouldFallThroughAmbiguous({ source: 'member_id', status: 429, json: { error: 'Too many scans' } }),
    false,
  );
});

test('shouldFallThroughAmbiguous: trial-pass not_a_pass (200) falls through', () => {
  assert.equal(
    shouldFallThroughAmbiguous({ source: 'trial_pass', status: 200, json: { ok: false, result: 'not_a_pass' } }),
    true,
  );
});

test('shouldFallThroughAmbiguous: trial-pass allowed (200) does not', () => {
  assert.equal(
    shouldFallThroughAmbiguous({ source: 'trial_pass', status: 200, json: { result: 'allowed', guest: {} } }),
    false,
  );
});

test('shouldFallThroughAmbiguous: unknown source never falls through', () => {
  assert.equal(
    shouldFallThroughAmbiguous({ source: 'ticket', status: 404, json: {} }),
    false,
  );
});
