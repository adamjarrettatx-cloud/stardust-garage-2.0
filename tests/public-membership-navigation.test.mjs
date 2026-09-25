import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const navbar = readFileSync(new URL('../app/components/Navbar.js', import.meta.url), 'utf8');
const navLinks = readFileSync(new URL('../app/components/NavLinks.js', import.meta.url), 'utf8');

test('public membership navigation does not depend on account or trial records', () => {
  assert.doesNotMatch(navbar, /showMembership|createAdminClient|auth\.getUser|member_profiles|trial_passes/);
  assert.match(navbar, /<NavLinks\s*\/>/);
});

test('desktop and mobile use the same unfiltered public membership link', () => {
  assert.match(navLinks, /href:\s*'\/members',\s*label:\s*'MEMBERSHIP'/);
  assert.equal((navLinks.match(/\{links\.map\(/g) || []).length, 2);
  assert.doesNotMatch(navLinks, /showMembership|visibleLinks|links\.filter/);
});
