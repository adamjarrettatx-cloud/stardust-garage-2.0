import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`../app/bananas/contacts/${name}`, import.meta.url), 'utf8');
const layout = read('ContactProfileLayout.js');
const detail = read('[id]/ContactDetailClient.js');
const form = read('ContactForm.js');
const css = read('profile.module.css');

test('profile separates the four workflows and preserves mounted editing panels', () => {
  for (const label of ['Overview', 'Legal & signing', 'Tax & payouts', 'Activity']) assert.ok(layout.includes(label));
  assert.match(layout, /hidden=\{activeSection !== 'overview'\}/);
  assert.match(layout, /hidden=\{activeSection !== 'legal'\}/);
  assert.match(layout, /hidden=\{activeSection !== 'tax'\}/);
  assert.match(layout, /hidden=\{activeSection !== 'activity'\}/);
});

test('New Contact uses the compact layout with creation-specific controls', () => {
  const page = read('new/page.js');
  assert.match(page, /<ContactForm initialCategory=\{category\} \/>/);
  assert.match(page, /max-w-\[1160px\]/);
  assert.ok(!/AuthenticatedPageHeader/.test(page));
  assert.match(form, /profile \|\| !isEditing/);
  assert.match(form, /createMode: true/);
  assert.match(layout, /profile\.createMode \? 'Create contact' : 'Save changes'/);
  assert.match(layout, /!profile\.createMode \? \[\{ id: 'activity'/);
  assert.match(layout, /profile\.createMode && !profile\.isOrganizer/);
});

test('independent tax and Mercury forms stay outside the contact form', () => {
  const endForm = layout.indexOf('</form>');
  assert.ok(endForm > 0);
  assert.ok(layout.indexOf('{profile.taxPanel}</div>') > endForm);
  assert.ok(layout.indexOf('{profile.activityPanel}</div>') > endForm);
});

test('header Save uses explicit form association and reveals invalid hidden fields', () => {
  assert.match(layout, /type="submit" form=\{formId\}/);
  assert.match(layout, /id=\{formId\}[^>]*noValidate/);
  assert.match(layout, /el\.willValidate && !el\.validity\.valid/);
  assert.match(layout, /requestAnimationFrame\(\(\) => invalid\.reportValidity\(\)\)/);
  assert.match(layout, /onKeyDown=\{onTabKeyDown\}/);
});

test('compact photos retain the current image URL model without new storage exposure', () => {
  assert.match(css, /width:64px;height:64px;flex:0 0 64px/);
  assert.match(layout, /aria-label="Change contact photo"/);
  assert.match(layout, /setField\('photo_url', next\)/);
  assert.ok(!/storage\.from|data:image|createObjectURL/.test(layout));
  assert.match(layout, /onError=\{\(\) => setFailed\(true\)\}/);
});

test('relationship editing preserves the canonical legacy-aware helpers and restricted statuses', () => {
  assert.match(layout, /CONTACT_STATUS_OPTIONS\.map/);
  assert.match(layout, /isContactTypeSelected\(typeDraft, opt\.value\)/);
  assert.match(layout, /toggleContactType\(prev, opt\.value\)/);
  assert.match(layout, /values\.status === 'do_not_book'/);
  assert.match(layout, /values\.status === 'archived'/);
});

test('administrator and owner actions retain their gates', () => {
  assert.match(detail, /canArchive: isAdmin/);
  assert.match(detail, /portalPanel: isAdmin \?/);
  assert.match(detail, /isAdmin && isContractor && <TaxProfileSection/);
  assert.match(detail, /isOwner && <PayoutProfileSection/);
  assert.match(detail, /showTaxStatus: isAdmin && isContractor/);
  assert.match(read('[id]/page.js'), /await requireTeam\(\)/);
  assert.match(read('[id]/page.js'), /isOwner=\{isAdmin && user\?\.email === OWNER_EMAIL\}/);
});

test('existing save, audit, legal validation and create-contact path are retained', () => {
  assert.match(form, /buildOrganizerPatch\(/);
  assert.match(form, /supabase\.from\('contacts'\)\.update\(payload\)/);
  assert.match(form, /supabase\.from\('contacts'\)\.insert\(payload\)/);
  assert.match(form, /logAudit\('status_change'/);
  assert.match(form, /logAudit\('update'/);
  assert.match(form, /setBaseline\(JSON\.stringify\(values\)\)/);
  assert.match(form, /profile\.onSaved\?\.\(saved\)/);
  assert.match(form, /finally \{\s*setSaving\(false\)/);
});

test('tax changes update both the panel and overview readiness status', () => {
  const tax = read('[id]/TaxProfileSection.js');
  assert.equal((tax.match(/onChange\?\.\(saved\)/g) || []).length, 3);
  assert.match(detail, /onChange=\{setTaxProfile\}/);
  assert.match(detail, /!taxProfile\?\.w9_on_file/);
});

test('responsive theme-aware layout avoids a second theme toggle', () => {
  assert.match(css, /var\(--auth-input-bg\)/);
  assert.match(css, /@media\(max-width:520px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.ok(!/AuthenticatedPageThemeToggle|AuthenticatedThemeToggleControl/.test(layout + detail));
});
