import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The trial-pass scan route now supports three modes: preview, checkin, reject.
// Pin the contract with source-level assertions so a refactor can't quietly
// change the state-mutation rules the door tablet relies on.

const src = readFileSync(
  new URL('../app/api/capacity/trial-pass/scan/route.js', import.meta.url),
  'utf8',
);

test('accepts only the three documented modes', () => {
  assert.match(src, /const VALID_MODES = new Set\(\[\s*'preview',\s*'checkin',\s*'reject'\s*\]\)/);
});

test('mode defaults to preview when omitted', () => {
  assert.match(src, /VALID_MODES\.has\(body\.mode\)\s*\?\s*body\.mode\s*:\s*'preview'/);
});

test('preview mode has NO writes to trial_passes and NO trial_pass_checkins insert', () => {
  const previewBlock = sliceBetween(src, "if (mode === 'preview')", "if (mode === 'reject')");
  assert.ok(previewBlock, 'expected a preview block');
  assert.equal(/\.update\(/.test(previewBlock), false, 'preview must not update rows');
  assert.equal(/trial_pass_checkins/.test(previewBlock), false, 'preview must not log an attempt');
  assert.equal(/sendTrialPassApplicationInvite/.test(previewBlock), false, 'preview must not send invite email');
  assert.equal(/trial_pass_emails/.test(previewBlock), false, 'preview must not claim the invite');
  assert.match(previewBlock, /buildTrialPassPreview\(/);
});

test('reject mode logs to trial_pass_checkins but NEVER activates the pass', () => {
  const rejectBlock = sliceBetween(src, "if (mode === 'reject')", 'MODE: checkin');
  assert.ok(rejectBlock, 'expected a reject block');
  assert.match(rejectBlock, /trial_pass_checkins/);
  assert.match(rejectBlock, /result:\s*'rejected'/);
  assert.match(rejectBlock, /reject_reason:\s*rejectReason/);
  // Never activates the pass: never sets activated_at, never sets expires_at
  assert.equal(/activated_at:/.test(rejectBlock), false, 'reject must not set activated_at');
  assert.equal(/sendTrialPassApplicationInvite/.test(rejectBlock), false, 'reject must not send invite');
});

test('reject mode requires a valid reject_reason', () => {
  assert.match(src, /isValidRejectReason\(rejectReason\)/);
  assert.match(src, /Missing or invalid reject_reason/);
});

test('reject mode caps note length at 280 chars', () => {
  assert.match(src, /body\?\.note[\s\S]*?\.slice\(0,\s*280\)/);
});

test('checkin mode still runs activation with the conditional-update race guard', () => {
  const checkinBlock = sliceBetween(src, 'MODE: checkin', 'function rejectReasonLabel');
  assert.ok(checkinBlock, 'expected a checkin block');
  assert.match(checkinBlock, /\.is\('activated_at',\s*null\)/);
});

test('checkin mode still fires the application invite path', () => {
  const checkinBlock = sliceBetween(src, 'MODE: checkin', 'function rejectReasonLabel');
  assert.match(checkinBlock, /sendTrialPassApplicationInvite/);
});

test('team gate is still enforced', () => {
  assert.match(src, /requireTeam\(request\)/);
});

test('device-token path still refuses non-front_door devices', () => {
  assert.match(src, /device\.role !== 'front_door'/);
});


test('scan route limits authenticated traffic by IP and credential before parsing the body', () => {
  assert.match(src, /import \{ rateLimit, keyFromRequest \} from '@\/lib\/rate-limit'/);
  assert.match(src, /keyFromRequest\(request, 'trial_pass_scan'\)/);
  assert.match(src, /limit:\s*10/);
  assert.match(src, /trial_pass_scan_credential:\$\{device\?\.id \|\| staffUserId\}/);
  assert.match(src, /limit:\s*30/);
  assert.match(src, /windowMs:\s*60 \* 60 \* 1000/);
  assert.match(src, /status:\s*429/);
  assert.ok(src.indexOf("staffUserId = user?.id || null") < src.indexOf("keyFromRequest(request, 'trial_pass_scan')"));
  assert.ok(src.indexOf("keyFromRequest(request, 'trial_pass_scan')") < src.indexOf('await request.json()'));
});

test('response payload always includes the mode field', () => {
  assert.match(src, /mode:\s*'preview'/);
  assert.match(src, /mode:\s*'reject'/);
  assert.match(src, /mode:\s*'checkin'/);
});

function sliceBetween(source, startMarker, endMarker) {
  const startIdx = source.indexOf(startMarker);
  if (startIdx < 0) return null;
  const rest = source.slice(startIdx);
  const endIdx = rest.indexOf(endMarker);
  return endIdx < 0 ? rest : rest.slice(0, endIdx);
}
