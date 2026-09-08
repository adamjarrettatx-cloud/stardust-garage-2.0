import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sniffScan } from '../lib/scan/sniff.js';
import { generateMemberIdentityToken } from '../lib/member-identity.js';
import { generatePassToken } from '../lib/trial-pass.js';
import { generateTicketCode } from '../lib/tickets/codes.js';

test('unknown for empty / non-string input', () => {
  assert.equal(sniffScan('').kind, 'unknown');
  assert.equal(sniffScan('   ').kind, 'unknown');
  assert.equal(sniffScan(null).kind, 'unknown');
  assert.equal(sniffScan(undefined).kind, 'unknown');
  assert.equal(sniffScan(42).kind, 'unknown');
});

test('member ID URL routes to member_id', () => {
  const token = generateMemberIdentityToken();
  const result = sniffScan(`https://sdgatx.com/member/id/${token}`);
  assert.equal(result.kind, 'member_id');
  assert.equal(result.token, token);
});

test('trial pass URL routes to trial_pass', () => {
  const token = generatePassToken();
  const result = sniffScan(`https://sdgatx.com/pass/${token}`);
  assert.equal(result.kind, 'trial_pass');
  assert.equal(result.token, token);
});

test('ticket URL /t/<code> routes to ticket', () => {
  const code = generateTicketCode();
  const result = sniffScan(`https://sdgatx.com/t/${code}`);
  assert.equal(result.kind, 'ticket');
  assert.equal(result.code, code);
});

test('ticket scanner URL /t/scan?t=<code> routes to ticket', () => {
  const code = generateTicketCode();
  const result = sniffScan(`https://sdgatx.com/t/scan?t=${code}`);
  assert.equal(result.kind, 'ticket');
  assert.equal(result.code, code);
});

test('bare ticket code routes to ticket', () => {
  const code = generateTicketCode();
  const result = sniffScan(code);
  assert.equal(result.kind, 'ticket');
  assert.equal(result.code, code);
});

test('bare 43-char token is ambiguous between member_id and trial_pass', () => {
  const token = generateMemberIdentityToken();
  const result = sniffScan(token);
  assert.equal(result.kind, 'ambiguous_token');
  assert.equal(result.token, token);
});

test('unrelated URL returns unknown', () => {
  assert.equal(sniffScan('https://instagram.com/stardustgarage').kind, 'unknown');
  assert.equal(sniffScan('https://sdgatx.com/events').kind, 'unknown');
});

test('unrelated bare payload returns unknown', () => {
  assert.equal(sniffScan('hello world').kind, 'unknown');
  assert.equal(sniffScan('WIFI:S:MyNet;T:WPA;P:pw;;').kind, 'unknown');
  assert.equal(sniffScan('mailto:hi@sdgatx.com').kind, 'unknown');
});

test('URL sniffers ignore paths that just contain the substring', () => {
  // Decoy: /wat/pass/xxx should NOT resolve as a trial-pass URL because the
  // trial-pass sniffer anchors on /pass/ as the top segment. Same for
  // /wat/member/id/xxx and /wat/t/xxx.
  const token = generatePassToken();
  assert.equal(sniffScan(`https://example.com/wat/pass/${token}`).kind, 'unknown');

  const memberToken = generateMemberIdentityToken();
  assert.equal(sniffScan(`https://example.com/wat/member/id/${memberToken}`).kind, 'unknown');
});

test('handles surrounding whitespace', () => {
  const token = generateMemberIdentityToken();
  const result = sniffScan(`   https://sdgatx.com/member/id/${token}   `);
  assert.equal(result.kind, 'member_id');
  assert.equal(result.token, token);
});
