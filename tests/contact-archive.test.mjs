import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../app/bananas/contacts/', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');

test('the contact delete component and delete operation are removed', () => {
  assert.equal(fs.existsSync(new URL('[id]/DeleteContactButton.js', root)), false);
  for (const file of ['ContactForm.js', 'ContactProfileLayout.js', '[id]/ContactDetailClient.js']) {
    assert.doesNotMatch(read(file), /deleteAction|DeleteContactButton|\.delete\(\)/);
  }
});

test('archival changes status only, preserves audit history, and guards unsaved edits', () => {
  const form = read('ContactForm.js');
  assert.match(form, /!profile\?\.canArchive \|\| !isEditing \|\| dirty \|\| saving/);
  assert.match(form, /restoring \? 'active' : 'archived'/);
  assert.match(form, /update\(\{ status: nextStatus, updated_by: user\?\.id \|\| null \}\)/);
  assert.match(form, /\.eq\('id', contact\.id\)\.eq\('status', contact\.status\)/);
  assert.match(form, /action: 'status_change', details: \{ from: contact\.status, to: nextStatus \}/);
  assert.match(form, /setBaseline\(JSON\.stringify\(\{ \.\.\.values, status: nextStatus \}\)\)/);
});

test('archived profiles offer restore and an archive-aware return link', () => {
  const layout = read('ContactProfileLayout.js');
  assert.match(layout, /Restore contact/);
  assert.match(layout, /Archive contact/);
  assert.match(layout, /Save or discard your changes first/);
  assert.match(layout, /contactDirectoryHref\(initialCategory, profile\.archivedView \|\| contact\.status === 'archived'\)/);
});
