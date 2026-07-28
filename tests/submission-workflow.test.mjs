import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  SUBMISSION_LIST_TABS,
  SUBMISSION_STATUS_META,
  SUBMISSION_TYPE_CONFIGS,
  canExplicitlyTransitionSubmission,
  countSubmissionStatuses,
  filterSubmissionRowsByStatus,
  normalizeSubmissionStatus,
  submissionActionsForStatus,
} from '../lib/submission-workflow.js';
import { updateSubmissionStatusRecord } from '../lib/submission-status.js';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function makeSupabase({ row = { id: 'row-1', status: 'new' }, updateError = null } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      from(table) {
        calls.push({ step: 'from', table });
        return {
          select() {
            calls.push({ step: 'select', table });
            return this;
          },
          eq(column, value) {
            calls.push({ step: 'eq', table, column, value });
            return this;
          },
          maybeSingle: async () => ({ data: row, error: null }),
          update(payload) {
            calls.push({ step: 'update', table, payload });
            return {
              eq(column, value) {
                calls.push({ step: 'update.eq', table, column, value });
                return {
                  select() {
                    calls.push({ step: 'update.select', table });
                    return {
                      single: async () => ({
                        data: updateError ? null : { id: row?.id || 'row-1', status: payload.status },
                        error: updateError,
                      }),
                    };
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}

test('normalizeSubmissionStatus treats missing legacy values as new', () => {
  assert.equal(normalizeSubmissionStatus(undefined), 'new');
  assert.equal(normalizeSubmissionStatus(null), 'new');
  assert.equal(normalizeSubmissionStatus('bogus'), 'new');
  assert.equal(normalizeSubmissionStatus('reviewed'), 'new');
  assert.equal(normalizeSubmissionStatus('contacted'), 'contacted');
});

test('countSubmissionStatuses and filtering keep legacy null rows in New', () => {
  const rows = [
    { id: '1', status: null },
    { id: '2', status: 'new' },
    { id: '3', status: 'contacted' },
  ];

  assert.deepEqual(countSubmissionStatuses(rows), {
    new: 2,
    contacted: 1,
    pending: 0,
    approved: 0,
    rejected: 0,
  });
  assert.deepEqual(filterSubmissionRowsByStatus(rows, 'new').map((row) => row.id), ['1', '2']);
});

test('there is no seen status or tab left in the workflow', () => {
  assert.equal('reviewed' in SUBMISSION_STATUS_META, false);
  for (const config of Object.values(SUBMISSION_TYPE_CONFIGS)) {
    assert.equal(config.tabs.includes('reviewed'), false);
  }
  assert.deepEqual(SUBMISSION_LIST_TABS.map((tab) => tab.id), [
    'new',
    'contacted',
    'pending',
    'approved',
    'rejected',
  ]);
});

test('new submissions only move to contacted or pending', () => {
  assert.deepEqual(submissionActionsForStatus('new').map((action) => action.status), [
    'contacted',
    'pending',
  ]);
  assert.equal(canExplicitlyTransitionSubmission('new', 'approved'), false);
  assert.equal(canExplicitlyTransitionSubmission('new', 'rejected'), false);
});

test('contacted and pending submissions only move to approved or rejected', () => {
  for (const status of ['contacted', 'pending']) {
    assert.deepEqual(submissionActionsForStatus(status).map((action) => action.status), [
      'approved',
      'rejected',
    ]);
    assert.equal(canExplicitlyTransitionSubmission(status, 'new'), false);
  }
});

test('approved and rejected are terminal', () => {
  for (const status of ['approved', 'rejected']) {
    assert.deepEqual(submissionActionsForStatus(status), []);
    for (const next of ['new', 'contacted', 'pending', 'approved', 'rejected']) {
      assert.equal(canExplicitlyTransitionSubmission(status, next), next === status);
    }
  }
});

test('submission type configs cover all repo submission types', () => {
  assert.deepEqual(Object.keys(SUBMISSION_TYPE_CONFIGS).sort(), [
    'applications',
    'collaborations',
    'micro-parties',
    'signups',
    'venue-inquiries',
  ]);
});

test('status updates are blocked when unauthorized', async () => {
  const result = await updateSubmissionStatusRecord({
    type: 'applications',
    id: 'app-1',
    nextStatus: 'contacted',
    deps: {
      requireAdminMfa: async () => ({ unauthorized: true, reason: 'mfa_required' }),
      createAdminClient: () => {
        throw new Error('should not create admin client');
      },
    },
  });

  assert.equal(result.status, 401);
  assert.equal(result.body.reason, 'mfa_required');
});

test('marking contacted mutates only on POST helper and counts can be recomputed after update', async () => {
  const db = makeSupabase({ row: { id: 'app-1', status: null } });

  const result = await updateSubmissionStatusRecord({
    type: 'applications',
    id: 'app-1',
    nextStatus: 'contacted',
    deps: {
      requireAdminMfa: async () => ({ unauthorized: false }),
      createAdminClient: () => db.client,
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.changed, true);
  assert.equal(result.body.previousStatus, 'new');
  assert.equal(result.body.status, 'contacted');
  assert.ok(db.calls.some((call) => call.step === 'update'));

  const counts = countSubmissionStatuses([
    { id: 'app-1', status: result.body.status },
    { id: 'app-2', status: 'new' },
  ]);
  assert.equal(counts.new, 1);
  assert.equal(counts.contacted, 1);
});

test('marking contacted is idempotent on double click', async () => {
  const db = makeSupabase({ row: { id: 'app-1', status: 'contacted' } });

  const result = await updateSubmissionStatusRecord({
    type: 'applications',
    id: 'app-1',
    nextStatus: 'contacted',
    deps: {
      requireAdminMfa: async () => ({ unauthorized: false }),
      createAdminClient: () => db.client,
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.changed, false);
  assert.equal(db.calls.some((call) => call.step === 'update'), false);
});

test('illegal transitions are rejected by the API helper', async () => {
  const db = makeSupabase({ row: { id: 'app-1', status: 'new' } });

  const result = await updateSubmissionStatusRecord({
    type: 'applications',
    id: 'app-1',
    nextStatus: 'approved',
    deps: {
      requireAdminMfa: async () => ({ unauthorized: false }),
      createAdminClient: () => db.client,
    },
  });

  assert.equal(result.status, 400);
  assert.equal(db.calls.some((call) => call.step === 'update'), false);
});

test('all submission types use the shared explicit workflow tables', async () => {
  for (const [type, config] of Object.entries(SUBMISSION_TYPE_CONFIGS)) {
    const db = makeSupabase({ row: { id: `${type}-1`, status: 'new' } });
    const result = await updateSubmissionStatusRecord({
      type,
      id: `${type}-1`,
      nextStatus: 'contacted',
      deps: {
        requireAdminMfa: async () => ({ unauthorized: false }),
        createAdminClient: () => db.client,
      },
    });

    assert.equal(result.status, 200, `${type} should update successfully`);
    const fromCall = db.calls.find((call) => call.step === 'from');
    assert.equal(fromCall?.table, config.table);
  }
});

test('admin submission views never mutate on view and never delete', () => {
  const sources = [
    'app/bananas/applications/[id]/ApplicationActions.js',
    'app/bananas/collaborations/[id]/CollaborationActions.js',
    'app/bananas/venue-inquiries/[id]/InquiryActions.js',
    'app/bananas/micro-parties/[id]/MicroPartyActions.js',
    'app/bananas/components/SubmissionActions.js',
    'app/bananas/signups/SignupsClient.js',
  ];

  for (const relativePath of sources) {
    const content = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
    assert.equal(/update\(\{\s*status:/.test(content), false, `${relativePath} should not write status directly`);
    assert.equal(content.includes('.delete()'), false, `${relativePath} should not delete submissions`);
    assert.equal(content.toLowerCase().includes('seen'), false, `${relativePath} should not reference seen`);
  }
});
