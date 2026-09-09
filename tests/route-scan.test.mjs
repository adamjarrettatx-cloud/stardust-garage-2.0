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

test('planScanAttempts refuses to route a ticket without an event', () => {
  // Without an event_id the tickets endpoint would just 400. Surface a
  // clean requiresEvent signal so the caller can render "Start Event first."
  const plan = planScanAttempts({ kind: 'ticket', code: 'ABC-123' });
  assert.equal(plan.kind, 'ticket');
  assert.equal(plan.requiresEvent, true);
  assert.equal(plan.attempts.length, 0);
});

test('planScanAttempts routes a ticket sniff to /api/tickets/scan with event', () => {
  const plan = planScanAttempts(
    { kind: 'ticket', code: 'ABC-123' },
    { eventId: 'evt-1', doorSessionId: 'ds-1' },
  );
  assert.equal(plan.kind, 'ticket');
  assert.equal(plan.attempts.length, 1);
  assert.equal(plan.attempts[0].endpoint, '/api/tickets/scan');
  assert.equal(plan.attempts[0].body.code, 'ABC-123');
  assert.equal(plan.attempts[0].body.event_id, 'evt-1');
  assert.equal(plan.attempts[0].body.door_session_id, 'ds-1');
  assert.equal(plan.attempts[0].body.mode, 'preview');
});

test('member_id attempt uses event_id + door_session_id field names', () => {
  const plan = planScanAttempts(
    { kind: 'member_id', token: 'abc' },
    { eventId: 'evt-1', doorSessionId: 'ds-1' },
  );
  const body = plan.attempts[0].body;
  assert.equal(body.event_id, 'evt-1');
  assert.equal(body.door_session_id, 'ds-1');
  // trial-pass style camelCase should NOT be present on the member body.
  assert.equal(body.eventId, undefined);
});

test('trial_pass attempt uses eventId (camelCase) + door_session_id', () => {
  // Endpoint field naming is inconsistent between routes — trial-pass reads
  // camelCase eventId while everyone else reads snake. If this ever gets
  // "cleaned up" without also updating the route, scans will silently lose
  // event context. This test is the guardrail.
  const plan = planScanAttempts(
    { kind: 'trial_pass', token: 'xyz' },
    { eventId: 'evt-1', doorSessionId: 'ds-1' },
  );
  const body = plan.attempts[0].body;
  assert.equal(body.eventId, 'evt-1');
  assert.equal(body.door_session_id, 'ds-1');
  assert.equal(body.event_id, undefined);
});

test('ambiguous_token threads context into BOTH attempts', () => {
  const plan = planScanAttempts(
    { kind: 'ambiguous_token', token: 'deadbeef' },
    { eventId: 'evt-1', doorSessionId: 'ds-1' },
  );
  assert.equal(plan.attempts.length, 2);
  assert.equal(plan.attempts[0].body.event_id, 'evt-1');
  assert.equal(plan.attempts[0].body.door_session_id, 'ds-1');
  assert.equal(plan.attempts[1].body.eventId, 'evt-1');
  assert.equal(plan.attempts[1].body.door_session_id, 'ds-1');
});

test('empty-string eventId / doorSessionId is treated as absent', () => {
  // Guards against a caller passing an uninitialized state ('') and
  // accidentally sending eventId: '' on the wire.
  const plan = planScanAttempts(
    { kind: 'member_id', token: 'abc' },
    { eventId: '', doorSessionId: '' },
  );
  const body = plan.attempts[0].body;
  assert.equal(body.event_id, undefined);
  assert.equal(body.door_session_id, undefined);
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
