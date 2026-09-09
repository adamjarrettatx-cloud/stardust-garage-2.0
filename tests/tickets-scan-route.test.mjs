import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The scan route now supports three modes: preview, checkin, reject.
// Pin the contract with source-level assertions so a refactor can't quietly
// change the state-mutation rules that door staff rely on.

const src = readFileSync(
  new URL('../app/api/tickets/scan/route.js', import.meta.url),
  'utf8',
);

test('accepts only the three documented modes', () => {
  assert.match(src, /const VALID_MODES = new Set\(\[\s*'preview',\s*'checkin',\s*'reject'\s*\]\)/);
});

test('preview mode has NO writes to tickets and NO ticket_checkins insert', () => {
  const previewBlock = sliceBetween(src, "if (mode === 'preview')", "if (mode === 'reject')");
  assert.ok(previewBlock, 'expected a preview block');
  assert.equal(/\.update\(/.test(previewBlock), false, 'preview must not update rows');
  assert.equal(/ticket_checkins/.test(previewBlock), false, 'preview must not log an attempt');
  assert.match(previewBlock, /buildBuyerPreview\(/);
});

test('reject mode logs to ticket_checkins but does NOT flip tickets.status', () => {
  const rejectBlock = sliceBetween(src, "if (mode === 'reject')", '// mode: \'checkin\'');
  assert.ok(rejectBlock, 'expected a reject block');
  assert.match(rejectBlock, /ticket_checkins/);
  assert.match(rejectBlock, /result:\s*CHECKIN_RESULTS\.REJECTED/);
  assert.equal(/from\('tickets'\)[\s\S]*\.update\(/.test(rejectBlock), false, 'reject must not update tickets');
});

test('reject mode requires a valid reject_reason', () => {
  assert.match(src, /isValidRejectReason\(rejectReason\)/);
  assert.match(src, /Missing or invalid reject_reason/);
});

test('checkin mode still enforces admin gate on override', () => {
  assert.match(src, /wantOverride && isAdmin && effective !== CHECKIN_RESULTS\.VALID/);
});

test('checkin mode still uses the atomic status="valid" WHERE guard', () => {
  const checkinBlock = sliceBetween(src, "mode: 'checkin'", 'if (effective === CHECKIN_RESULTS.OVERRIDE)');
  assert.ok(checkinBlock, 'expected a checkin block');
  assert.match(checkinBlock, /\.eq\('status',\s*'valid'\)/);
});

test('team-only gate is still enforced', () => {
  assert.match(src, /requireTeam\(/);
  assert.match(src, /gate\.unauthorized/);
});

test('rate limit still applies', () => {
  assert.match(src, /rateLimit\(\{\s*key:\s*keyFromRequest\(request,\s*'ticket_scan'\)/);
});

// ---- helpers ----
function sliceBetween(source, startMarker, endMarker) {
  const startIdx = source.indexOf(startMarker);
  if (startIdx < 0) return null;
  const rest = source.slice(startIdx);
  const endIdx = rest.indexOf(endMarker);
  return endIdx < 0 ? rest : rest.slice(0, endIdx);
}
