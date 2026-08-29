import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const walk = (dir, out = []) => {
  const abs = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, out);
    else if (entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
};

// The theme toggle belongs in one place: the admin shell header, beside Log Out.
// Every page inside the shell inherits it. A page that renders its own as well
// puts two identical switches on one screen.
const SHELL_HEADER = 'app/components/AuthenticatedPageHeader.js';

test('the shell header is what supplies the theme toggle', () => {
  assert.match(read(SHELL_HEADER), /AuthenticatedPageThemeToggle/);
  assert.match(read('app/bananas/AdminShell.js'), /AuthenticatedPageHeader/);
});

test('no page inside the admin shell renders its own theme toggle', () => {
  // Everything under app/bananas is always wrapped by the shell, so a toggle
  // here is always a duplicate.
  const offenders = walk('app/bananas').filter((rel) => {
    if (rel.endsWith('app/bananas/AdminShell.js')) return false;
    return /AuthenticatedThemeToggleControl|AuthenticatedPageThemeToggle/.test(read(rel));
  });
  assert.deepEqual(offenders, [], `these duplicate the shell's theme toggle: ${offenders.join(', ')}`);
});

test('team pages offer a toggle only when they are not inside the shell', () => {
  // These three are reachable by non-admin team members, who never see the
  // shell and so need their own toggle. For an admin the shell provides it, so
  // theirs must be suppressed rather than deleted.
  const conditional = [
    'app/team/calendar/CalendarClient.js',
    'app/team/chat/TeamChatClient.js',
  ];
  for (const rel of conditional) {
    const src = read(rel);
    assert.match(src, /useInAdminShell/, `${rel} must know whether it is in the shell`);
    const uses = [...src.matchAll(/<AuthenticatedThemeToggleControl/g)].length;
    assert.equal(uses, 1, `${rel} should render the toggle in exactly one place`);
    assert.match(
      src,
      /\{!inShell && \(\s*<AuthenticatedThemeToggleControl/,
      `${rel} renders its toggle unconditionally, duplicating the shell's`
    );
  }
});

test('the Tasks admin view suppresses its toggle but the team view keeps one', () => {
  // Tasks has two views in one file. Only the admin view can be wrapped.
  const src = read('app/team/progress/ProgressClient.js');
  const split = src.indexOf('function TeamProgressView');
  assert.ok(split > 0, 'TeamProgressView not found');
  const adminView = src.slice(0, split);
  const teamView = src.slice(split);

  assert.match(adminView, /\{!inShell && \(\s*<AuthenticatedThemeToggleControl/);
  assert.match(teamView, /<AuthenticatedThemeToggleControl/, 'the team view lost its toggle');
  assert.ok(
    !/inShell/.test(teamView),
    'the team view is never wrapped, so it must not gate its toggle'
  );
});

// --- Tasks: creation happens through Quick Add only -------------------------

test('Tasks has no CSV import', () => {
  const src = read('app/team/progress/ProgressClient.js');
  assert.ok(!/IMPORT CSV/.test(src), 'the CSV import button is back');
  assert.ok(!/ImportModal|showImport/.test(src), 'leftover CSV import wiring');
  // The whole chain went with it: the button was the only entry point to
  // ImportModal, which was the only caller of /api/progress/import, which was
  // the only consumer of lib/progress-csv.js. An authenticated endpoint that
  // can bulk-create tasks with nothing pointing at it is surface with no
  // upside.
  for (const orphan of [
    'app/bananas/progress/ImportModal.js',
    'app/api/progress/import/route.js',
    'lib/progress-csv.js',
  ]) {
    assert.ok(
      !fs.existsSync(path.join(REPO_ROOT, orphan)),
      `${orphan} had no remaining consumer and should be gone`
    );
  }
});

test('Tasks creates only through Quick Add', () => {
  const src = read('app/team/progress/ProgressClient.js');
  assert.ok(!/\+ NEW TASK/.test(src), 'the New Task button is back');
  assert.ok(
    !/setFormTask\(null\)/.test(src),
    'null opens the form in create mode; Quick Add is the only create path'
  );
  // Quick Add must still be there, and the form must still open for editing.
  assert.match(src, /submitQuickAdd/, 'Quick Add is the only way to create a task');
  assert.match(src, /setFormTask\(t\)/, 'editing an existing task must still work');
});
