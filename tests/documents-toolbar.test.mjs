import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// The Documents toolbar carried three controls that earned their removal:
//   - a status dropdown that hid drafts/archived docs by default
//   - a second theme toggle, on top of the admin shell's
//   - an "ALL" category tab that mixed every category into one long list

test('the Documents toolbar has no status dropdown', () => {
  const src = read('app/bananas/documents/DocumentsClient.js');
  assert.ok(!/setFilter\('status'/.test(src), 'the status filter dropdown is back');
  assert.ok(!/<option value="archived">/.test(src), 'leftover status options');
});

test('the Documents page inherits the shell theme toggle instead of adding one', () => {
  assert.match(read('app/bananas/documents/page.js'), /showThemeToggle=\{false\}/);
  assert.match(read('app/components/AuthenticatedPageHeader.js'), /showThemeToggle = true/);
});

test('the Documents category tabs are real categories only, defaulting to contracts', () => {
  const client = read('app/bananas/documents/DocumentsClient.js');
  assert.ok(!/label: 'All'/.test(client), 'the ALL tab is back');
  assert.match(client, /\{categories\.map\(\(c\) => \{/);
  assert.match(read('app/bananas/documents/page.js'), /sp\?\.category \|\| 'contracts'/);
});

test('nothing is hidden by default now that the status filter is gone', () => {
  assert.match(read('app/bananas/documents/page.js'), /sp\?\.status \|\| 'all'/);
});
