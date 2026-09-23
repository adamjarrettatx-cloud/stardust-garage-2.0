import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../app/bananas/applications/ApplicationsList.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/bananas/applications/applications.module.css', import.meta.url), 'utf8');

test('application photos and initials share the edge-to-edge square tile', () => {
  assert.equal((component.match(/className=\{styles\.photo\}/g) || []).length, 2);
  assert.doesNotMatch(component, /borderRadius: '50%'|w-11 h-11/);
  assert.match(css, /\.card\s*\{[^}]*overflow: hidden/s);
  assert.match(css, /\.photo\s*\{[^}]*width: 102px;[^}]*height: 102px;[^}]*object-fit: cover/s);
  assert.match(component, /<Avatar application=\{a\} \/>\s*<div className=\{styles\.content\}>/);
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
  assert.match(component, /formatDate\(a\.created_at\)/);
  assert.match(css, /@media \(max-width: 640px\)/);
});
