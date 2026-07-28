import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { markNewSignupsSeen } from '../lib/signups-seen.js';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

// Mirrors the shape of the service-role client's filtered update, and records
// every call so tests can assert the table and the WHERE clause.
function makeAdminClient({ error = null, rows = [{ id: 's-1', status: 'new' }] } = {}) {
  const calls = [];
  const client = {
    from(table) {
      calls.push({ step: 'from', table });
      return {
        update(payload) {
          calls.push({ step: 'update', table, payload });
          return {
            eq(column, value) {
              calls.push({ step: 'update.eq', table, column, value });
              const matched = rows.filter((row) => row[column] === value);
              for (const row of matched) row.status = payload.status;
              return Promise.resolve({ data: matched, error });
            },
          };
        },
      };
    },
  };
  return { calls, client, rows };
}

test('loading the signups page flips every new signup to seen', async () => {
  const db = makeAdminClient({
    rows: [
      { id: 's-1', status: 'new' },
      { id: 's-2', status: 'new' },
      { id: 's-3', status: 'seen' },
    ],
  });

  const result = await markNewSignupsSeen({ createAdminClient: () => db.client });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(db.calls, [
    { step: 'from', table: 'signups' },
    { step: 'update', table: 'signups', payload: { status: 'seen' } },
    { step: 'update.eq', table: 'signups', column: 'status', value: 'new' },
  ]);
  assert.deepEqual(db.rows.map((row) => row.status), ['seen', 'seen', 'seen']);
});

test('the auto-seen update is idempotent because it only matches new rows', async () => {
  const db = makeAdminClient({ rows: [{ id: 's-1', status: 'new' }] });

  await markNewSignupsSeen({ createAdminClient: () => db.client });
  await markNewSignupsSeen({ createAdminClient: () => db.client });

  assert.deepEqual(db.rows, [{ id: 's-1', status: 'seen' }]);
  const filters = db.calls.filter((call) => call.step === 'update.eq');
  assert.equal(filters.length, 2);
  for (const filter of filters) {
    assert.deepEqual(filter, { step: 'update.eq', table: 'signups', column: 'status', value: 'new' });
  }
});

test('the auto-seen update only ever touches the signups table', async () => {
  const db = makeAdminClient();

  await markNewSignupsSeen({ createAdminClient: () => db.client });

  assert.deepEqual([...new Set(db.calls.map((call) => call.table))], ['signups']);
});

test('a failed auto-seen update never breaks the signups page render', async () => {
  const db = makeAdminClient({ error: { message: 'permission denied' } });
  const failed = await markNewSignupsSeen({ createAdminClient: () => db.client });
  assert.deepEqual(failed, { ok: false, error: 'permission denied' });

  const threw = await markNewSignupsSeen({
    createAdminClient: () => {
      throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
    },
  });
  assert.deepEqual(threw, { ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY' });
});

test('the signups page performs the transition server-side with the admin client', () => {
  const page = readSource('app/bananas/signups/page.js');
  assert.match(page, /markNewSignupsSeen/);
  assert.equal(page.includes("'use client'"), false);

  // The fetch must happen before the update so this render still shows the rows
  // as New; they land under Seen on the next load.
  assert.ok(page.indexOf(".from('signups')") < page.indexOf('markNewSignupsSeen()'));

  const helper = readSource('lib/signups-seen.js');
  assert.match(helper, /supabase\/admin/);
  assert.equal(helper.includes('supabase/server'), false);
});

test('the signups page has no click-to-act status control left', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'app/bananas/components/SignupStatusButton.js')), false);

  const client = readSource('app/bananas/signups/SignupsClient.js');
  assert.equal(client.includes('SignupStatusButton'), false);
  assert.equal(client.includes('useSubmissionStatus'), false);
  assert.equal(/update\(\{\s*status:/.test(client), false);
  assert.equal(client.includes('.delete()'), false);
});

test('the auto-seen path stays out of the shared submission status workflow', () => {
  for (const relativePath of [
    'lib/submission-status.js',
    'app/api/admin/submissions/[type]/[id]/status/route.js',
  ]) {
    assert.equal(
      readSource(relativePath).includes('seen'),
      false,
      `${relativePath} should not reference the signups-only seen status`,
    );
  }

  const helper = readSource('lib/signups-seen.js');
  for (const table of ['membership_applications', 'venue_inquiries', 'micro_party_inquiries', 'collaborations']) {
    assert.equal(helper.includes(table), false, `auto-seen helper should not touch ${table}`);
  }
});

test('the signups migration only narrows the signups status constraint', () => {
  const migration = readSource('supabase/migrations/20260728_signups_seen_status.sql');

  assert.match(migration, /update public\.signups set status = 'seen' where status = 'contacted'/);
  assert.match(migration, /status is null or status not in \('new', 'seen'\)/);
  assert.match(migration, /drop constraint if exists signups_status_check/);
  assert.match(migration, /check \(status in \('new', 'seen'\)\)/);

  const statements = migration
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  for (const table of ['membership_applications', 'venue_inquiries', 'micro_party_inquiries', 'collaborations']) {
    assert.equal(statements.includes(table), false, `migration should not touch ${table}`);
  }
});
