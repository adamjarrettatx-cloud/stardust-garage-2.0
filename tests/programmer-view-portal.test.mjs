import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isViewPortalSandbox } from '../lib/view-portal/preview-only.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('preview-only applies only to the isolated sandbox', () => {
  assert.equal(isViewPortalSandbox({ VIEW_PORTAL_MODE: 'sandbox' }), true);
  assert.equal(isViewPortalSandbox({ VIEW_PORTAL_MODE: 'launcher' }), false);
  assert.equal(isViewPortalSandbox({}), false);
});

test('pitch send and withdraw are refused server-side in the sandbox', () => {
  for (const p of ['app/api/portal/pitches/route.js', 'app/api/portal/pitches/[id]/withdraw/route.js']) {
    const src = read(p);
    const post = src.slice(src.indexOf('export async function POST'));
    assert.match(post.split('\n')[1], /if \(isViewPortalSandbox\(\)\) return NextResponse\.json\(\{ error: PREVIEW_ONLY_MESSAGE \}, \{ status: 403 \}\)/);
  }
});

test('calendar and pitches pages render the pitch form view-only in the sandbox', () => {
  assert.match(read('app/portal/(loggedin)/calendar/page.js'), /previewOnly=\{isViewPortalSandbox\(\)\}/);
  const cal = read('app/portal/(loggedin)/calendar/ProgrammingCalendar.jsx');
  assert.match(cal, /if \(sending \|\| previewOnly\) return;/);
  assert.match(cal, /disabled=\{sending \|\| previewOnly\}/);
  assert.match(cal, /disabled=\{busy \|\| previewOnly\}/);
  assert.match(read('app/portal/(loggedin)/pitches/page.js'), /<WithdrawButton id=\{p\.id\} disabled=\{previewOnly\} \/>/);
});
