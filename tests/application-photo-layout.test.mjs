import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../app/bananas/applications/ApplicationsList.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/bananas/applications/applications.module.css', import.meta.url), 'utf8');

test('application photos and initials share a large top image area', () => {
  assert.match(component, /<div className=\{styles\.photo\}>/);
  assert.doesNotMatch(component, /borderRadius: '50%'|w-11 h-11/);
  assert.match(css, /\.card\s*\{[^}]*overflow: hidden/s);
  assert.match(css, /\.photo\s*\{[^}]*aspect-ratio: 4 \/ 3/s);
  assert.match(css, /\.photo img\s*\{[^}]*object-fit: cover/s);
  assert.match(component, /<ApplicationPhoto application=\{a\} \/>\s*<div className=\{styles\.body\}>/);
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

test('cards adapt to the actual content area alongside the admin sidebar', () => {
  assert.match(css, /container-type: inline-size/);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@container \(max-width: 920px\).*repeat\(2, minmax\(0,1fr\)\)/);
  assert.match(css, /@container \(max-width: 600px\).*grid-template-columns: minmax\(0,1fr\)/);
  assert.doesNotMatch(css, /height: (104|170)px/);
});

test('contact fields are labeled and dates use Austin time', () => {
  for (const label of ['Email', 'Phone', 'Social']) {
    assert.ok(component.includes(`<dt>${label}</dt>`));
  }
  assert.match(component, /<time dateTime=\{a\.created_at\}>/);
  assert.equal((component.match(/timeZone: 'America\/Chicago'/g) || []).length, 2);
  assert.match(component, /View application for/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /\.card:focus-visible/);
});
