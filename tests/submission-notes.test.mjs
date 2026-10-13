import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSubmissionNote,
  deleteSubmissionNote,
  listSubmissionNotes,
  normalizeNoteBody,
  updateSubmissionNote,
} from '../lib/submission-notes.js';

const SUB = '11111111-1111-1111-1111-111111111111';
const ADAM = { id: 'u-adam', email: 'adam@sdgatx.com' };
const JEYU = { id: 'u-jeyu', email: 'jeyu@sdgatx.com' };
const TEAM = {
  'u-adam': { email: 'adam@sdgatx.com', full_name: 'Adam Jarrett' },
  'u-jeyu': { email: 'jeyu@sdgatx.com', full_name: 'Jeyu Bigelow' },
};

// Minimal in-memory stand-in for the Supabase query builder paths used.
function fakeDb() {
  const rows = [];
  let seq = 0;
  function builder(table) {
    const filters = [];
    let op = 'select';
    let payload = null;
    const api = {
      select() { return api; },
      insert(p) { op = 'insert'; payload = p; return api; },
      update(p) { op = 'update'; payload = p; return api; },
      eq(k, v) { filters.push((r) => r[k] === v); return api; },
      is(k, v) { filters.push((r) => (r[k] ?? null) === v); return api; },
      order() { return api; },
      limit() { return api; },
      run() {
        if (op === 'insert') {
          const row = { id: `n${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), edited_at: null, deleted_at: null, ...payload };
          rows.push(row);
          return { data: row, error: null };
        }
        const matched = rows.filter((r) => filters.every((f) => f(r)));
        if (op === 'update') {
          matched.forEach((r) => Object.assign(r, payload));
          return { data: matched[0] || null, error: null };
        }
        return { data: matched, error: null };
      },
      single() { const r = api.run(); return Promise.resolve({ ...r, data: Array.isArray(r.data) ? r.data[0] : r.data }); },
      maybeSingle() { return api.single(); },
      then(res, rej) { return Promise.resolve(api.run()).then(res, rej); },
    };
    if (table === 'team_members') {
      let uid = null;
      api.eq = (k, v) => { if (k === 'user_id') uid = v; return api; };
      api.maybeSingle = () => Promise.resolve({ data: TEAM[uid] || null, error: null });
    }
    return api;
  }
  return { rows, client: { from: builder } };
}

function depsFor(user, db) {
  return {
    requireAdminMfa: async () => (user ? { user, unauthorized: false } : { user: null, unauthorized: true, reason: 'not_admin' }),
    createAdminClient: async () => db.client,
    ownerEmail: 'adam@sdgatx.com',
    submissionExists: async () => ({ ok: true }),
  };
}

test('non-admins cannot read or write notes', async () => {
  const db = fakeDb();
  const deps = depsFor(null, db);
  assert.equal((await listSubmissionNotes({ type: 'venue-inquiries', id: SUB, deps })).status, 401);
  assert.equal((await createSubmissionNote({ type: 'venue-inquiries', id: SUB, rawBody: 'x', deps })).status, 401);
  assert.equal(db.rows.length, 0);
});

test('unknown submission types are rejected (signups have no notes)', async () => {
  const db = fakeDb();
  const r = await createSubmissionNote({ type: 'signups', id: SUB, rawBody: 'x', deps: depsFor(JEYU, db) });
  assert.equal(r.status, 404);
});

test('author identity comes from the session and team profile, not the client', async () => {
  const db = fakeDb();
  const r = await createSubmissionNote({ type: 'venue-inquiries', id: SUB, rawBody: '  Called her, wants Nov 14  ', deps: depsFor(JEYU, db) });
  assert.equal(r.status, 201);
  assert.equal(r.body.note.author_name, 'Jeyu Bigelow');
  assert.equal(r.body.note.body, 'Called her, wants Nov 14');
  assert.equal(db.rows[0].author_id, 'u-jeyu');
  assert.equal(db.rows[0].author_email, 'jeyu@sdgatx.com');
});

test('every admin sees every note, newest first, with viewer-specific controls', async () => {
  const db = fakeDb();
  await createSubmissionNote({ type: 'venue-inquiries', id: SUB, rawBody: 'first', deps: depsFor(JEYU, db) });
  await createSubmissionNote({ type: 'venue-inquiries', id: SUB, rawBody: 'second', deps: depsFor(ADAM, db) });
  const asJeyu = await listSubmissionNotes({ type: 'venue-inquiries', id: SUB, deps: depsFor(JEYU, db) });
  assert.equal(asJeyu.body.notes.length, 2);
  const jeyuOwn = asJeyu.body.notes.find((n) => n.body === 'first');
  const adamsAsJeyu = asJeyu.body.notes.find((n) => n.body === 'second');
  assert.deepEqual([jeyuOwn.can_edit, jeyuOwn.can_delete], [true, true]);
  assert.deepEqual([adamsAsJeyu.can_edit, adamsAsJeyu.can_delete], [false, false]);
  const asAdam = await listSubmissionNotes({ type: 'venue-inquiries', id: SUB, deps: depsFor(ADAM, db) });
  const jeyuAsAdam = asAdam.body.notes.find((n) => n.body === 'first');
  assert.deepEqual([jeyuAsAdam.can_edit, jeyuAsAdam.can_delete], [false, true]);
});

test('only the author can edit; edits are stamped', async () => {
  const db = fakeDb();
  const { body } = await createSubmissionNote({ type: 'collaborations', id: SUB, rawBody: 'draft', deps: depsFor(JEYU, db) });
  const denied = await updateSubmissionNote({ type: 'collaborations', id: SUB, noteId: body.note.id, rawBody: 'hijack', deps: depsFor(ADAM, db) });
  assert.equal(denied.status, 403);
  const ok = await updateSubmissionNote({ type: 'collaborations', id: SUB, noteId: body.note.id, rawBody: 'final', deps: depsFor(JEYU, db) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.note.body, 'final');
  assert.ok(ok.body.note.edited_at);
});

test('author or owner can delete; delete is soft and hides the note', async () => {
  const db = fakeDb();
  const { body } = await createSubmissionNote({ type: 'micro-parties', id: SUB, rawBody: 'note', deps: depsFor(ADAM, db) });
  const denied = await deleteSubmissionNote({ type: 'micro-parties', id: SUB, noteId: body.note.id, deps: depsFor(JEYU, db) });
  assert.equal(denied.status, 403);
  const { body: b2 } = await createSubmissionNote({ type: 'micro-parties', id: SUB, rawBody: 'jeyu note', deps: depsFor(JEYU, db) });
  const ownerDelete = await deleteSubmissionNote({ type: 'micro-parties', id: SUB, noteId: b2.note.id, deps: depsFor(ADAM, db) });
  assert.equal(ownerDelete.status, 200);
  assert.ok(db.rows.find((r) => r.id === b2.note.id).deleted_at, 'row retained with deleted_at');
  const list = await listSubmissionNotes({ type: 'micro-parties', id: SUB, deps: depsFor(JEYU, db) });
  assert.deepEqual(list.body.notes.map((n) => n.body), ['note']);
});

test('note body validation', () => {
  assert.ok(normalizeNoteBody('   ').error);
  assert.ok(normalizeNoteBody(null).error);
  assert.ok(normalizeNoteBody('x'.repeat(5001)).error);
  assert.equal(normalizeNoteBody('a\r\nb').body, 'a\nb');
});
