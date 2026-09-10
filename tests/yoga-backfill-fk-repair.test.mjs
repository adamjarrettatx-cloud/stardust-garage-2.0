import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const repairMigration = readFileSync(
  new URL('../supabase/migrations/20260910120000_repair_yoga_financial_fks.sql', import.meta.url),
  'utf8',
);

// This repository's unit tests do not connect to a Supabase database. After
// deploying this repair, run the "Manual verification after deploy" CTE in the
// migration: event_financial_config and pos_import_batches should have counts
// only against the recreated 2026-09-09 occurrence, never the Sep 16 source ID.
test('Yoga financial-FK repair targets the original source and both omitted tables', () => {
  assert.match(repairMigration, /do \$\$/i);
  assert.match(
    repairMigration,
    /where id = v_old_id and event_date = '2026-09-16'/,
    'must retain the original backfill source predicate',
  );
  assert.match(
    repairMigration,
    /where slug = 'yoga-sound-healing-at-stardust-garage-2026-09-09'\s+and event_date = '2026-09-09'/,
    'must find the recreated Sep 9 occurrence explicitly',
  );
  assert.match(
    repairMigration,
    /update public\.event_financial_config\s+set event_id = v_new_id\s+where event_id = v_old_id;/,
  );
  assert.match(
    repairMigration,
    /update public\.pos_import_batches\s+set event_id = v_new_id\s+where event_id = v_old_id;/,
  );
  assert.match(repairMigration, /Manual verification after deploy/);
});
