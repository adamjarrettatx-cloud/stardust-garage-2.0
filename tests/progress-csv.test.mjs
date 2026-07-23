import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImportCsv, resolveDepartment } from '../lib/progress-csv.js';

test('resolveDepartment matches labels, slugs and aliases case-insensitively', () => {
  assert.equal(resolveDepartment('Marketing'), 'marketing');
  assert.equal(resolveDepartment('weekend_programming'), 'weekend_programming');
  assert.equal(resolveDepartment('Weekend Programming'), 'weekend_programming');
  assert.equal(resolveDepartment('Supplies / Inventory'), 'supplies_inventory');
  assert.equal(resolveDepartment('supplies'), 'supplies_inventory');
  assert.equal(resolveDepartment('Membership'), 'memberships');
  assert.equal(resolveDepartment('Nonsense'), null);
});

test('parseImportCsv maps the standard three-column export', () => {
  const csv = [
    'Department/Area,Deliverable,Status',
    'Marketing,Summer flyer,In progress',
    'Legal,Vendor contract,Blocked - waiting on signature',
    'App,Push notifications,Done',
  ].join('\n');
  const { rows, errors } = parseImportCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    line: 2,
    department: 'marketing',
    title: 'Summer flyer',
    status: 'in_progress',
    statusNote: 'In progress',
  });
  assert.equal(rows[1].status, 'blocked');
  assert.equal(rows[1].statusNote, 'Blocked - waiting on signature');
  assert.equal(rows[2].status, 'done');
});

test('parseImportCsv reports unknown departments and missing titles as errors', () => {
  const csv = [
    'Department,Deliverable,Status',
    'Nonsense,Some task,todo',
    'Marketing,,todo',
    'Legal,Real task,todo',
  ].join('\n');
  const { rows, errors } = parseImportCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Real task');
  assert.equal(errors.length, 2);
  assert.match(errors[0].message, /Unknown department/);
  assert.match(errors[1].message, /Missing deliverable/);
});

test('parseImportCsv skips blank spacer rows', () => {
  const csv = ['Department,Deliverable,Status', 'Marketing,Task A,done', ',,', 'Legal,Task B,todo'].join('\n');
  const { rows, errors } = parseImportCsv(csv);
  assert.equal(errors.length, 0);
  assert.deepEqual(rows.map((r) => r.title), ['Task A', 'Task B']);
});

test('parseImportCsv rejects a file with no usable header', () => {
  const { rows, errors } = parseImportCsv('Foo,Bar\n1,2');
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Header must include/);
});

test('parseImportCsv handles quoted fields with embedded commas', () => {
  const csv = ['Department,Deliverable,Status', 'Marketing,"Flyer, poster, and banner",done'].join('\n');
  const { rows } = parseImportCsv(csv);
  assert.equal(rows[0].title, 'Flyer, poster, and banner');
});

test('parseImportCsv tolerates Deliverable-only files (no status column)', () => {
  const csv = ['Area,Task', 'Data,Build dashboard'].join('\n');
  const { rows, errors } = parseImportCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows[0].department, 'data');
  assert.equal(rows[0].status, 'not_started');
  assert.equal(rows[0].statusNote, '');
});
