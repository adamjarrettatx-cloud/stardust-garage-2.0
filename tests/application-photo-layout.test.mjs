import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../app/bananas/applications/ApplicationsList.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/bananas/components/profile-list.module.css', import.meta.url), 'utf8');
const frame = readFileSync(new URL('../app/bananas/applications/applications.module.css', import.meta.url), 'utf8');

test('applications render as large-photo list rows, never circular avatars', () => {
  assert.match(component, /import styles from '\.\.\/components\/profile-list\.module\.css'/);
  assert.match(component, /<ul className=\{styles\.list\} data-testid="applications-list">/);
  assert.match(component, /<div className=\{styles\.photo\} style=\{\{ aspectRatio: '1 \/ 1' \}\}>/);
  assert.match(component, /<ApplicationPhoto application=\{a\} \/>\s*<div className=\{styles\.identity\}>/);
  assert.doesNotMatch(component, /borderRadius: '50%'|w-11 h-11|styles\.grid|styles\.card/);
  assert.match(css, /grid-template-columns: 144px/);
  assert.match(css, /\.photo img\s*\{[^}]*object-fit: cover/s);
  assert.match(component, /<SubmissionTabs type="applications"[^>]*exactCounts/);
});

test('signed photos remain preferred and failed photos fall back to initials', () => {
  assert.match(component, /application\.display_photo_url \|\| application\.photo_url/);
  assert.match(component, /src && src !== failedUrl/);
  assert.match(component, /onError=\{\(\) => setFailedUrl\(src\)\}/);
  assert.match(component, /initials\(application\.full_name\)/);
});

test('application routes and status filtering remain intact', () => {
  assert.match(component, /href=\{`\/bananas\/applications\/\$\{a\.id\}`\}/);
  assert.match(component, /filterSubmissionRowsByStatus\(applications, activeTab\)/);
  assert.match(component, /<SubmissionTabs type="applications"/);
  assert.match(component, /dateParts\(a\.created_at\)/);
});

test('rows adapt to the actual content area alongside the admin sidebar', () => {
  assert.match(frame, /container-type: inline-size/);
  assert.match(css, /@container \(max-width: 760px\)/);
  assert.match(css, /@container \(max-width: 420px\)/);
  assert.match(css, /\.photo \{ grid-area: photo; width: 120px; \}/);
});

test('contact fields are labeled and dates use Austin time', () => {
  for (const label of ['Email', 'Phone', 'Social']) {
    assert.ok(component.includes(`<dt>${label}</dt>`));
  }
  assert.match(component, /<time dateTime=\{a\.created_at\}>/);
  assert.equal((component.match(/timeZone: 'America\/Chicago'/g) || []).length, 2);
  assert.match(component, /View application for/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /\.row:focus-visible/);
});
