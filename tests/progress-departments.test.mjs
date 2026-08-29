import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEPARTMENTS, departmentLabel, normalizeDepartmentFilter } from '../lib/progress.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const MIGRATION = 'supabase/migrations/20260829_progress_department_vocabulary.sql';

const slugs = DEPARTMENTS.map((d) => d.slug);

test('the new department vocabulary is exactly what was asked for', () => {
  assert.deepEqual(slugs, [
    'marketing', 'memberships', 'programming', 'operations', 'website',
    'data', 'supplies_inventory', 'products', 'awareness', 'management', 'legal',
  ]);
  assert.equal(departmentLabel('programming'), 'Programming');
  assert.equal(departmentLabel('website'), 'Website');
  assert.equal(departmentLabel('operations'), 'Operations');
});

test('the merged and renamed slugs are gone', () => {
  for (const retired of ['weekend_programming', 'weekday_programming', 'app']) {
    assert.ok(!slugs.includes(retired), `${retired} should have been migrated away`);
    // A stale localStorage value or an old bookmark must degrade to "All"
    // rather than selecting a tab that no longer exists.
    assert.equal(normalizeDepartmentFilter(retired), '');
  }
});

test('no code still references a retired slug', () => {
  const walk = (dir, out = []) => {
    const abs = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(abs)) return out;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel, out);
      else if (/\.(js|mjs)$/.test(entry.name)) out.push(rel);
    }
    return out;
  };
  const offenders = [];
  for (const rel of [...walk('app'), ...walk('lib')]) {
    const src = read(rel);
    for (const retired of ['weekend_programming', 'weekday_programming']) {
      if (src.includes(retired) && !src.includes('20260829_progress_department_vocabulary')) {
        offenders.push(`${rel} (${retired})`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('the migration moves data before it re-tightens the constraints', () => {
  const sql = read(MIGRATION);
  // Order is the whole correctness argument: remapping under the old CHECK
  // would reject 'programming'/'website', and re-adding the new CHECK before
  // the remap would reject the old rows.
  const dropTask = sql.indexOf('drop constraint if exists project_tasks_department_check');
  const remap = sql.indexOf("set department = 'programming'");
  const addTask = sql.indexOf('add constraint project_tasks_department_check');
  assert.ok(dropTask > -1 && remap > -1 && addTask > -1, 'migration is missing a step');
  assert.ok(dropTask < remap, 'the constraint must be dropped before the remap');
  assert.ok(remap < addTask, 'the constraint must be re-added after the remap');
});

test('the migration covers both department columns', () => {
  const sql = read(MIGRATION);
  // team_members.departments mirrors the same vocabulary; missing it would let
  // a member keep a tag the tasks table no longer allows.
  assert.match(sql, /update public\.project_tasks/);
  assert.match(sql, /update public\.team_members/);
  assert.match(sql, /add constraint team_members_departments_check/);
  // The merge is many-to-one, so a member tagged with both programming
  // departments has to collapse to one entry.
  assert.match(sql, /array_agg\(distinct/);
});

test('both CHECK constraints list the same slugs as lib/progress.js', () => {
  const sql = read(MIGRATION);
  const constraints = [...sql.matchAll(/add constraint (\w+)[\s\S]*?\);/g)].map((m) => m[0]);
  assert.equal(constraints.length, 2, 'expected one constraint per department column');
  for (const block of constraints) {
    for (const slug of slugs) {
      assert.ok(block.includes(`'${slug}'`), `${slug} missing from a CHECK constraint`);
    }
    for (const retired of ['weekend_programming', 'weekday_programming', "'app'"]) {
      assert.ok(!block.includes(retired), `${retired} still allowed by a CHECK constraint`);
    }
  }
});

// --- the Tasks page chrome Adam asked to remove -----------------------------

const TASKS_PAGE = 'app/team/progress/ProgressClient.js';

test('the Tasks page no longer shows KPI cards or the filter row', () => {
  const src = read(TASKS_PAGE);
  for (const gone of [
    'KPI_DEFS',           // Total tasks / Overdue / Done this week
    'Search deliverables',
    'All statuses',
    'All priorities',
    'All assignees',
    "'ARCHIVED'",         // the ACTIVE/ARCHIVED toggle
  ]) {
    assert.ok(!src.includes(gone), `${gone} should have been removed from the Tasks page`);
  }
});

test('removing the sort dropdown left sorting intact on the column headers', () => {
  const src = read(TASKS_PAGE);
  assert.ok(!src.includes('Recently updated'), 'the sort select should be gone');
  // Sorting is not lost, it moved: every column header is still clickable.
  assert.match(src, /<SortableTh/);
  assert.match(src, /toggleSort/);
});

test('the department strip uses the shared underline tabs', () => {
  const src = read(TASKS_PAGE);
  assert.match(src, /UnderlineTabs/, 'the last pill row should now use UnderlineTabs');
  assert.ok(!/rounded-full px-4 py-2 text-\[12px\]/.test(src), 'leftover pill styling');
  assert.match(src, /testId="progress-department-tabs"/, 'test hooks were dropped');
});
