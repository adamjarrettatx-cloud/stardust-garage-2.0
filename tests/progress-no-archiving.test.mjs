// Task archiving was removed entirely (owner: "remove archive completely ..
// never needed it"). These tests are the guard that it does not creep back in
// via a copied component, a re-added PATCH field, or a stale server query.
//
// NOTE: "archive" also means something completely unrelated in this codebase --
// SignNow archives a signed contract PDF into the document hub, and documents
// have an 'archived' status. Those are a different feature and must keep
// working, so every check here is scoped to the progress-tracker files.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { filterTasks } from '../lib/progress.js';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const PROGRESS_FILES = [
  'lib/progress.js',
  'lib/progress-drawer-theme.js',
  'app/team/progress/page.js',
  'app/team/progress/ProgressClient.js',
  'app/bananas/progress/TaskDrawer.js',
  'app/api/progress/tasks/[id]/route.js',
];

test('no progress-tracker file references task archiving', () => {
  for (const rel of PROGRESS_FILES) {
    const src = read(rel);
    for (const [n, line] of src.split('\n').entries()) {
      // Allow the one comment that explains the removal.
      if (/archive toggle are gone/.test(line)) continue;
      assert.ok(
        !/archiv/i.test(line),
        `${rel}:${n + 1} still mentions archiving: ${line.trim()}`,
      );
    }
  }
});

test('the task PATCH allowlist does not accept archived', () => {
  const src = read('app/api/progress/tasks/[id]/route.js');
  assert.ok(!/'archived'/.test(src), 'archived must not be a patchable task field');
});

test('the task drawer has no archive or unarchive action', () => {
  const src = read('app/bananas/progress/TaskDrawer.js');
  assert.ok(!/Unarchive/.test(src));
  assert.ok(!/>Archive</.test(src));
  // The actions that remain.
  assert.ok(/Mark complete/.test(src), 'Mark complete should still be there');
  assert.ok(/Delete/.test(src), 'owner hard delete should still be there');
});

test('no progress query filters on the dropped column', () => {
  for (const rel of PROGRESS_FILES) {
    assert.ok(
      !/\.eq\(\s*'archived'/.test(read(rel)),
      `${rel} queries a column that no longer exists`,
    );
  }
});

test('the drawer theme no longer carries archived badge tokens', () => {
  const src = read('lib/progress-drawer-theme.js');
  assert.ok(!/archivedBg|archivedText/.test(src));
});

test('filterTasks ignores the retired archived key instead of hiding everything', () => {
  const base = {
    id: 'x', title: 't', department: 'marketing', status: 'not_started',
    priority: 'p2', assignee_id: null, due_date: null,
  };
  const tasks = [{ ...base, id: '1' }, { ...base, id: '2' }];
  // Both directions of the old key must be inert, so a stale saved filter or an
  // old client cannot blank the table.
  assert.deepEqual(filterTasks(tasks, { archived: true }).map((t) => t.id), ['1', '2']);
  assert.deepEqual(filterTasks(tasks, { archived: false }).map((t) => t.id), ['1', '2']);
});

test('the removal migration replaces both triggers before dropping the columns', () => {
  const src = read('supabase/migrations/20260829_remove_task_archiving.sql');
  const bookkeeping = src.indexOf('function public.project_tasks_bookkeeping');
  const logUpdate = src.indexOf('function public.project_tasks_log_update');
  const dropCols = src.indexOf('drop column if exists archived');
  assert.ok(bookkeeping > -1 && logUpdate > -1 && dropCols > -1);
  // Both trigger bodies read NEW.archived; dropping the columns first would
  // leave triggers that raise on the next task UPDATE.
  assert.ok(bookkeeping < dropCols, 'bookkeeping trigger must be replaced first');
  assert.ok(logUpdate < dropCols, 'activity trigger must be replaced first');
  // And neither replacement body may still touch the column.
  const replaced = src.slice(bookkeeping, dropCols)
    .split('\n')
    .filter((l) => !l.trim().startsWith('--')) // comments explain the removal
    .join('\n');
  assert.ok(!/\barchived\b/.test(replaced), 'replaced trigger bodies still read archived');
});

test('the migration drops the index and retires both activity actions', () => {
  const src = read('supabase/migrations/20260829_remove_task_archiving.sql');
  assert.ok(/drop index if exists public\.project_tasks_archived_idx/.test(src));
  assert.ok(/drop column if exists archived_at/.test(src));
  const check = src.slice(src.indexOf('add constraint project_task_activity_action_check'));
  assert.ok(!/'archived'|'unarchived'/.test(check), 'retired actions must be out of the CHECK');
  for (const kept of ['created', 'status_changed', 'assigned', 'reprioritized',
    'due_changed', 'cadence_changed', 'percent_changed', 'completed',
    'update_posted', 'edited']) {
    assert.ok(check.includes(`'${kept}'`), `${kept} must stay a valid activity action`);
  }
});

test('contract and document archiving is untouched', () => {
  // Guard against an over-eager future cleanup: this is a different feature.
  assert.ok(/archiveSignedContractPdf/.test(read('lib/document-helpers.js')));
  assert.ok(/'archived'/.test(read('app/api/admin/documents/[id]/route.js')),
    'documents keep their archived status');
});

test('no stray archive UI is left anywhere under the progress trees', () => {
  const walk = (dir, out = []) => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (e.endsWith('.js')) out.push(full);
    }
    return out;
  };
  const roots = ['app/team/progress', 'app/bananas/progress', 'app/api/progress'];
  for (const root of roots) {
    for (const file of walk(new URL(`../${root}`, import.meta.url).pathname)) {
      const src = readFileSync(file, 'utf8');
      const hit = src.split('\n').find((l) => /archiv/i.test(l) && !/archive toggle are gone/.test(l));
      assert.equal(hit, undefined, `${file} still mentions archiving: ${hit}`);
    }
  }
});
