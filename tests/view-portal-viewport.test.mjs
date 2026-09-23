import assert from 'node:assert/strict';
import test from 'node:test';
import { safePreviewPath, VIEWPORT_PRESETS } from '../lib/view-portal/viewport.js';
const origin = 'https://preview.example.test';
test('phone presets describe real CSS viewport dimensions', () => {
  assert.deepEqual(VIEWPORT_PRESETS.map((p) => p.width), [375, 390, 430]);
  assert.ok(VIEWPORT_PRESETS.every((p) => p.height > p.width));
});
test('mobile navigation preserves same-origin pages, query strings and fragments', () => {
  for (const path of ['/account/profile', '/team/calendar?view=week#today', '/bananas']) {
    assert.equal(safePreviewPath(path, origin), path);
  }
});
test('mobile messages cannot redirect outside preview or into control endpoints', () => {
  for (const path of ['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', '/view-preview/exit', '/a/../view-preview/redeem', null, {}]) {
    assert.equal(safePreviewPath(path, origin), null);
  }
});
