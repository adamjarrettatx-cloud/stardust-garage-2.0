import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeLedgerRows } from '../lib/financial-ledger-write.js';

// A stand-in for the service-role client backed by an in-memory
// financial_transactions table. It models the two Postgres behaviours this fix
// is about:
//
//   * financial_transactions_source_ref_uidx is a PARTIAL unique index, so a
//     duplicate (source, external_ref) insert fails while duplicate rows with a
//     null external_ref are allowed.
//   * PostgREST cannot express the index predicate, so .upsert() on that target
//     fails the way production did. Any regression back to .upsert() therefore
//     fails these tests instead of only failing on the deployed database.
const ON_CONFLICT_ERROR =
  'there is no unique or exclusion constraint matching the ON CONFLICT specification';

function mockSupabase({ seed = [] } = {}) {
  let nextId = 1;
  const table = seed.map((row) => ({ id: `seed-${nextId++}`, ...row }));
  const calls = { selects: 0, inserts: 0, updates: 0 };

  function insertOne(row) {
    if (row.external_ref != null) {
      const clash = table.find(
        (r) => r.source === row.source && r.external_ref === row.external_ref,
      );
      if (clash) {
        return `duplicate key value violates unique constraint "financial_transactions_source_ref_uidx"`;
      }
    }
    table.push({ id: `new-${nextId++}`, ...row });
    return null;
  }

  const from = (name) => {
    assert.equal(name, 'financial_transactions');
    const filters = [];
    const builder = {
      select() {
        calls.selects++;
        builder._mode = 'select';
        return builder;
      },
      insert(rows) {
        calls.inserts++;
        const list = Array.isArray(rows) ? rows : [rows];
        builder._result = { data: null, error: null };
        for (const row of list) {
          const message = insertOne(row);
          if (message) {
            builder._result = { data: null, error: { message } };
            break;
          }
        }
        return builder;
      },
      update(patch) {
        calls.updates++;
        builder._mode = 'update';
        builder._patch = patch;
        return builder;
      },
      upsert() {
        builder._result = { data: null, error: { message: ON_CONFLICT_ERROR } };
        return builder;
      },
      eq(column, value) {
        filters.push((row) => row[column] === value);
        return builder;
      },
      in(column, values) {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      then(resolve) {
        if (builder._result) return resolve(builder._result);
        const matched = table.filter((row) => filters.every((f) => f(row)));
        if (builder._mode === 'update') {
          for (const row of matched) Object.assign(row, builder._patch);
          return resolve({ data: matched, error: null });
        }
        return resolve({ data: matched, error: null });
      },
    };
    return builder;
  };

  return { supabase: { from }, table, calls };
}

const ACCOUNT = '11111111-1111-4111-8111-111111111111';

function ttRow(eventId, amount) {
  return {
    account_id: ACCOUNT,
    transaction_date: '2026-07-04',
    amount,
    direction: 'in',
    txn_type: 'operating',
    category: 'Ticket Revenue',
    source: 'tickettailor',
    external_ref: eventId,
    linked_event_id: eventId,
    metadata: { gross_cents: 1000 },
    created_by: null,
  };
}

test('a first write inserts every row', async () => {
  const { supabase, table } = mockSupabase();
  const result = await writeLedgerRows(supabase, [ttRow('event-1', '10.00'), ttRow('event-2', '20.00')]);

  assert.deepEqual(result, { inserted: 2, updated: 0 });
  assert.equal(table.length, 2);
});

// The production bug: the second sync raised
// "Could not write the ledger: there is no unique or exclusion constraint
// matching the ON CONFLICT specification" because PostgREST's onConflict cannot
// target a partial unique index.
test('re-running a sync updates in place instead of erroring or duplicating', async () => {
  const { supabase, table } = mockSupabase();
  await writeLedgerRows(supabase, [ttRow('event-1', '10.00')]);
  const result = await writeLedgerRows(supabase, [ttRow('event-1', '35.50')]);

  assert.deepEqual(result, { inserted: 0, updated: 1 });
  assert.equal(table.length, 1, 'the same (source, external_ref) must not duplicate');
  assert.equal(table[0].amount, '35.50', 'the existing row takes the new amount');
});

test('a mixed re-run inserts only the new refs', async () => {
  const { supabase, table } = mockSupabase();
  await writeLedgerRows(supabase, [ttRow('event-1', '10.00')]);
  const result = await writeLedgerRows(supabase, [ttRow('event-1', '11.00'), ttRow('event-2', '20.00')]);

  assert.deepEqual(result, { inserted: 1, updated: 1 });
  assert.equal(table.length, 2);
});

test('the same ref under a different source is a separate row', async () => {
  const { supabase, table } = mockSupabase();
  await writeLedgerRows(supabase, [ttRow('shared-ref', '10.00')]);
  const result = await writeLedgerRows(supabase, [
    { ...ttRow('shared-ref', '20.00'), source: 'spoton_csv' },
  ]);

  assert.deepEqual(result, { inserted: 1, updated: 0 });
  assert.equal(table.length, 2);
});

// (source, external_ref) pairs must be matched together. A naive `.in('source',
// [...]).in('external_ref', [...])` would match the cross product and update the
// wrong transaction.
test('cross-source keys are not confused when both sources are written at once', async () => {
  const { supabase, table } = mockSupabase();
  await writeLedgerRows(supabase, [
    ttRow('ref-a', '10.00'),
    { ...ttRow('ref-b', '20.00'), source: 'spoton_csv' },
  ]);
  const result = await writeLedgerRows(supabase, [
    ttRow('ref-b', '30.00'),
    { ...ttRow('ref-a', '40.00'), source: 'spoton_csv' },
  ]);

  assert.deepEqual(result, { inserted: 2, updated: 0 });
  assert.equal(table.length, 4);
});

test('duplicate keys within one call collapse to the last row', async () => {
  const { supabase, table } = mockSupabase();
  const result = await writeLedgerRows(supabase, [ttRow('event-1', '10.00'), ttRow('event-1', '99.00')]);

  assert.deepEqual(result, { inserted: 1, updated: 0 });
  assert.equal(table.length, 1);
  assert.equal(table[0].amount, '99.00');
});

test('rows without an external_ref always insert (the index ignores them)', async () => {
  const { supabase, table } = mockSupabase();
  const manual = { ...ttRow('event-1', '5.00'), external_ref: null, linked_event_id: null };
  await writeLedgerRows(supabase, [manual]);
  const result = await writeLedgerRows(supabase, [manual]);

  assert.deepEqual(result, { inserted: 1, updated: 0 });
  assert.equal(table.length, 2);
});

test('an empty write touches the database not at all', async () => {
  const { supabase, calls } = mockSupabase();
  const result = await writeLedgerRows(supabase, []);

  assert.deepEqual(result, { inserted: 0, updated: 0 });
  assert.deepEqual(calls, { selects: 0, inserts: 0, updates: 0 });
});

test('a database error surfaces instead of being swallowed', async () => {
  const { supabase } = mockSupabase();
  supabase.from = () => ({
    select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: null, error: { message: 'statement timeout' } }) }) }),
  });

  await assert.rejects(() => writeLedgerRows(supabase, [ttRow('event-1', '10.00')]), /statement timeout/);
});

// Guard rail for the mock itself: it must reproduce the failure the fix removed,
// otherwise the tests above would pass against the broken implementation too.
test('the mock still rejects a PostgREST upsert on the partial index', async () => {
  const { supabase } = mockSupabase();
  const { error } = await supabase
    .from('financial_transactions')
    .upsert([ttRow('event-1', '10.00')], { onConflict: 'source,external_ref' });

  assert.match(error.message, /no unique or exclusion constraint/);
});
