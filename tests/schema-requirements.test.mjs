import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_SCHEMA,
  requirementKey,
  buildPresentSet,
  diffSchema,
  requiredTableNames,
  formatMissing,
} from '../lib/schema-requirements.js';

// The guard's whole value is that it would have caught the PR #28 incident:
// code depending on events.visibility deployed before the column existed.
// These tests lock in the pure diff logic that the CLI runner and the admin
// health page both rely on.

test('REQUIRED_SCHEMA includes the PR #28 incident columns', () => {
  const keys = REQUIRED_SCHEMA.map((r) => requirementKey(r));
  assert.ok(keys.includes('public.events.visibility'), 'events.visibility must be guarded');
  assert.ok(keys.includes('public.events.event_type'), 'events.event_type must be guarded');
});

test('REQUIRED_SCHEMA includes PR #19 tables and PR #23 snapshot columns', () => {
  const keys = REQUIRED_SCHEMA.map((r) => requirementKey(r));
  assert.ok(keys.includes('public.event_financial_config'));
  assert.ok(keys.includes('public.pos_import_batches'));
  assert.ok(keys.includes('public.pos_import_rows'));
  assert.ok(keys.includes('public.event_financial_config.snapshot_stardust_split_percent'));
  assert.ok(keys.includes('public.event_financial_config.snapshot_contract_id'));
});

test('requirementKey: columns and tables key into distinct namespaces', () => {
  assert.equal(
    requirementKey({ kind: 'column', table: 'events', column: 'visibility' }),
    'public.events.visibility'
  );
  assert.equal(
    requirementKey({ kind: 'table', table: 'pos_import_rows' }),
    'public.pos_import_rows'
  );
});

test('buildPresentSet: a present column implies its table is present', () => {
  const set = buildPresentSet({
    columnRows: [{ table_schema: 'public', table_name: 'events', column_name: 'visibility' }],
  });
  assert.ok(set.has('public.events.visibility'));
  assert.ok(set.has('public.events'), 'column presence implies table presence');
});

test('buildPresentSet: defaults schema to public and ignores malformed rows', () => {
  const set = buildPresentSet({
    columnRows: [{ table_name: 'events', column_name: 'event_type' }, null, {}],
    tableRows: [{ table_name: 'pos_import_rows' }, null],
  });
  assert.ok(set.has('public.events.event_type'));
  assert.ok(set.has('public.pos_import_rows'));
});

test('diffSchema: reports OK when every required object is present', () => {
  // Build a present-set that satisfies all requirements.
  const present = new Set();
  for (const req of REQUIRED_SCHEMA) {
    present.add(requirementKey(req));
    present.add(`public.${req.table}`);
  }
  const report = diffSchema(present);
  assert.equal(report.ok, true);
  assert.equal(report.missing.length, 0);
  assert.equal(report.checked, REQUIRED_SCHEMA.length);
});

test('diffSchema: the PR #28 failure mode is detected (visibility missing)', () => {
  // Everything present EXCEPT events.visibility — exactly what happened in prod.
  const present = new Set();
  for (const req of REQUIRED_SCHEMA) {
    const key = requirementKey(req);
    if (key === 'public.events.visibility') continue;
    present.add(key);
    present.add(`public.${req.table}`);
  }
  const report = diffSchema(present);
  assert.equal(report.ok, false);
  const missingKeys = report.missing.map((m) => m.key);
  assert.deepEqual(missingKeys, ['public.events.visibility']);
  assert.equal(report.missing[0].kind, 'column');
  assert.match(report.missing[0].since, /PR #28/);
});

test('diffSchema: an empty database reports every requirement missing', () => {
  const report = diffSchema(new Set());
  assert.equal(report.ok, false);
  assert.equal(report.missing.length, REQUIRED_SCHEMA.length);
});

test('diffSchema: accepts a plain array as well as a Set', () => {
  const report = diffSchema(['public.events.visibility']);
  assert.equal(report.ok, false);
  assert.ok(report.present.includes('public.events.visibility'));
});

test('requiredTableNames: returns the distinct set of tables', () => {
  const names = requiredTableNames();
  assert.ok(names.includes('events'));
  assert.ok(names.includes('event_financial_config'));
  assert.ok(names.includes('pos_import_batches'));
  assert.ok(names.includes('pos_import_rows'));
  // Distinct — event_financial_config appears in many requirements but once here.
  assert.equal(names.length, new Set(names).size);
});

test('formatMissing: produces a readable line per missing object', () => {
  const lines = formatMissing([
    { key: 'public.events.visibility', kind: 'column', since: 'PR #28', note: 'public events filter' },
    { key: 'public.pos_import_rows', kind: 'table' },
  ]);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /MISSING column public\.events\.visibility \[PR #28\] — public events filter/);
  assert.match(lines[1], /MISSING table public\.pos_import_rows/);
});

test('end-to-end: information_schema-shaped rows flow through to a clean report', () => {
  // Simulate the runner fetching information_schema and feeding buildPresentSet.
  const columnRows = [];
  const tableRows = [];
  for (const req of REQUIRED_SCHEMA) {
    if (req.kind === 'column') {
      columnRows.push({ table_schema: 'public', table_name: req.table, column_name: req.column });
    } else {
      tableRows.push({ table_schema: 'public', table_name: req.table });
    }
  }
  const present = buildPresentSet({ columnRows, tableRows });
  const report = diffSchema(present);
  assert.equal(report.ok, true, 'fully-migrated DB should pass');
});
