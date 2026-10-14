import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  claimInvite,
  deleteTeamMessage,
  getMyConversation,
  getTeamConversation,
  hashInviteToken,
  inviteToConversation,
  listMyConversations,
  maskEmail,
  normalizeEmail,
  openQuestionIds,
  postGuestMessage,
  postTeamMessage,
  setConversationStatus,
  statusAfterFirstContact,
} from '../lib/submission-conversations.js';

const SUB = '11111111-1111-1111-1111-111111111111';
const APP = '22222222-2222-2222-2222-222222222222';
const ADAM = { id: 'u-adam', email: 'adam@sdgatx.com' };
const JEYU = { id: 'u-jeyu', email: 'jeyu@sdgatx.com' };
const GUEST = { id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'jane@example.com', user_metadata: {} };
const OTHER = { id: 'aaaaaaaa-0000-0000-0000-000000000002', email: 'someone@example.com', user_metadata: {} };

// In-memory stand-in for the Supabase query-builder paths this module uses.
function fakeDb(seed = {}) {
  const tables = {
    venue_inquiries: [{ id: SUB, status: 'new', full_name: 'Jane Doe', email: 'Jane@Example.com', event_name: 'Album Release', event_type: 'Party', created_at: '2026-10-01T00:00:00Z' }],
    membership_applications: [{ id: APP, status: 'new', full_name: 'Jane Doe', preferred_name: null, email: 'jane@example.com', plan: 'weekender', applicant_user_id: GUEST.id, created_at: '2026-10-01T00:00:00Z' }],
    team_members: [
      { user_id: ADAM.id, email: 'adam@sdgatx.com', full_name: 'Adam Jarrett' },
      { user_id: JEYU.id, email: 'jeyu@sdgatx.com', full_name: 'Jeyu Bigelow' },
    ],
    free_accounts: [{ user_id: GUEST.id, full_name: 'Jane Doe' }],
    submission_threads: [],
    submission_thread_messages: [],
    submission_thread_invites: [],
    ...seed,
  };
  let seq = 0;
  let clock = 0;
  const derive = (table, row) => {
    if (table !== 'submission_threads') return { ...row };
    const after = (a, b) => Boolean(a) && (!b || new Date(a) > new Date(b));
    return { ...row, awaiting_team: after(row.last_guest_message_at, row.team_last_read_at), unread_by_guest: after(row.last_team_message_at, row.guest_last_read_at) };
  };
  function builder(table) {
    const filters = [];
    let op = 'select';
    let payload = null;
    let order = null;
    const match = (r) => filters.every(([k, kind, v]) => (kind === 'eq' ? r[k] === v : kind === 'is' ? (r[k] ?? null) === v : v.includes(r[k])));
    function run() {
      const rows = tables[table] || (tables[table] = []);
      if (op === 'insert') {
        const list = (Array.isArray(payload) ? payload : [payload]).map((p) => {
          if (table === 'submission_threads' && rows.some((r) => r.submission_type === p.submission_type && r.submission_id === p.submission_id)) {
            throw Object.assign(new Error('duplicate'), { dup: true });
          }
          clock += 1;
          const row = { id: `${table}-${++seq}`, created_at: new Date(Date.UTC(2026, 9, 14, 12, 0, clock)).toISOString(), deleted_at: null, revoked_at: null, kind: 'message', reply_to_id: null, status: 'open', ...p };
          rows.push(row);
          return row;
        });
        return list.map((r) => derive(table, r));
      }
      let hit = rows.filter(match);
      if (op === 'update') {
        hit.forEach((r) => Object.assign(r, payload));
      }
      hit = hit.map((r) => derive(table, r));
      if (order) hit.sort((a, b) => (a[order.col] > b[order.col] ? 1 : -1) * (order.asc ? 1 : -1));
      return hit;
    }
    const api = {
      select() { return api; },
      insert(p) { op = 'insert'; payload = p; return api; },
      update(p) { op = 'update'; payload = p; return api; },
      eq(k, v) { filters.push([k, 'eq', v]); return api; },
      is(k, v) { filters.push([k, 'is', v]); return api; },
      in(k, v) { filters.push([k, 'in', v]); return api; },
      order(col, opts) { order = { col, asc: opts?.ascending !== false }; return api; },
      limit() { return api; },
      maybeSingle() { return settle((rows) => rows[0] || null); },
      single() { return settle((rows) => rows[0] || null, true); },
      then(resolve, reject) { return settle((rows) => rows).then(resolve, reject); },
    };
    function settle(pick, strict = false) {
      try {
        const rows = run();
        const data = pick(rows);
        if (strict && !data) return Promise.resolve({ data: null, error: { message: 'no rows' } });
        return Promise.resolve({ data, error: null });
      } catch (err) {
        return Promise.resolve({ data: null, error: { message: err.message } });
      }
    }
    return api;
  }
  return { tables, from: builder };
}

function harness({ viewer = ADAM, guest = GUEST, seed } = {}) {
  const db = fakeDb(seed);
  const sent = { invites: [], messages: [] };
  const notified = [];
  let token = 0;
  const deps = {
    createAdminClient: async () => db,
    requireAdminMfa: async () => (viewer ? { user: viewer } : { unauthorized: true }),
    ownerEmail: 'adam@sdgatx.com',
    getUser: async () => guest,
    siteUrl: async () => 'https://sdgatx.test',
    findAccount: async (_db, email) => (email === 'jane@example.com' ? { id: GUEST.id } : null),
    notify: async (_db, opts) => { notified.push(opts); if (opts.email) await opts.email.send(); return { ok: true }; },
    adminAudience: async () => [ADAM.id, JEYU.id],
    newInviteToken: () => `tok_${String(++token).padStart(30, 'x')}`,
    email: {
      sendConversationInvite: async (args) => { sent.invites.push(args); },
      sendConversationMessage: async (args) => { sent.messages.push(args); },
    },
  };
  return { db, deps, sent, notified, as: (patch) => ({ ...deps, ...patch }) };
}

test('pure helpers', () => {
  assert.equal(normalizeEmail('  Jane@Example.COM '), 'jane@example.com');
  assert.equal(normalizeEmail('nope'), null);
  assert.equal(maskEmail('jane.doe@gmail.com'), 'ja\u2022\u2022\u2022@gmail.com');
  assert.equal(statusAfterFirstContact('new'), 'contacted');
  assert.equal(statusAfterFirstContact('seen'), 'contacted');
  assert.equal(statusAfterFirstContact('pending'), null);
  assert.match(hashInviteToken('abc'), /^[0-9a-f]{64}$/);
  const msgs = [
    { id: 'q1', kind: 'question', author_kind: 'team' },
    { id: 'q2', kind: 'question', author_kind: 'team' },
    { id: 'a1', kind: 'message', author_kind: 'guest', reply_to_id: 'q1' },
  ];
  assert.deepEqual(openQuestionIds(msgs), ['q2']);
});

test('only admins can open or start a conversation', async () => {
  const h = harness({ viewer: null });
  assert.equal((await getTeamConversation({ type: 'venue-inquiries', id: SUB, deps: h.deps })).status, 401);
  assert.equal((await inviteToConversation({ type: 'venue-inquiries', id: SUB, deps: h.deps })).status, 401);
  assert.equal((await inviteToConversation({ type: 'signups', id: SUB, deps: harness().deps })).status, 404);
});

test('invite creates one thread, an opening question, a hashed link, and marks the submission Contacted', async () => {
  const h = harness();
  const res = await inviteToConversation({ type: 'venue-inquiries', id: SUB, rawBody: 'What date works best?', kind: 'question', deps: h.deps });
  assert.equal(res.status, 201);
  assert.equal(res.body.thread.invite_email, 'jane@example.com');
  assert.equal(res.body.thread.joined, false);
  assert.equal(res.body.messages.length, 1);
  assert.equal(res.body.messages[0].kind, 'question');
  assert.equal(res.body.messages[0].open_question, true);
  assert.equal(res.body.messages[0].author_name, 'Adam Jarrett');
  assert.equal(res.body.delivery.delivered, 'email');

  const invite = h.db.tables.submission_thread_invites[0];
  assert.equal(invite.token_hash, hashInviteToken(`tok_${'1'.padStart(30, 'x')}`));
  assert.ok(!JSON.stringify(h.db.tables).includes(`tok_${'1'.padStart(30, 'x')}`), 'raw token must not be stored');
  assert.equal(h.sent.invites.length, 1);
  assert.equal(h.sent.invites[0].url, `https://sdgatx.test/inbox/tok_${'1'.padStart(30, 'x')}`);
  assert.equal(h.sent.invites[0].hasAccount, true);
  assert.equal(h.sent.invites[0].isQuestion, true);
  assert.equal(h.db.tables.venue_inquiries[0].status, 'contacted');

  // A second invite reuses the same thread.
  const again = await inviteToConversation({ type: 'venue-inquiries', id: SUB, deps: h.deps });
  assert.equal(again.status, 200);
  assert.equal(h.db.tables.submission_threads.length, 1);
});

test('membership applications link straight to the verified applicant account', async () => {
  const h = harness();
  const res = await inviteToConversation({ type: 'applications', id: APP, rawBody: 'Welcome! Quick question.', deps: h.deps });
  assert.equal(res.status, 201);
  assert.equal(res.body.thread.joined, true);
  assert.equal(h.db.tables.submission_thread_invites.length, 0);
  assert.equal(h.notified.length, 1);
  assert.equal(h.notified[0].userId, GUEST.id);
  assert.equal(h.notified[0].type, 'conversation_message');
  assert.equal(h.sent.messages[0].url, `https://sdgatx.test/account/messages/${res.body.thread.id}`);
});

test('claiming requires the invited email, and a claimed thread stays with its account', async () => {
  const h = harness();
  await inviteToConversation({ type: 'venue-inquiries', id: SUB, rawBody: 'Hi', deps: h.deps });
  const token = `tok_${'1'.padStart(30, 'x')}`;

  assert.equal((await claimInvite({ token: 'bad', user: GUEST, deps: h.deps })).reason, 'invalid');
  assert.equal((await claimInvite({ token, user: null, deps: h.deps })).reason, 'signed_out');
  assert.equal((await claimInvite({ token, user: OTHER, deps: h.deps })).reason, 'email_mismatch');
  assert.equal(h.db.tables.submission_threads[0].participant_user_id, null);

  const ok = await claimInvite({ token, user: { ...GUEST, email: 'JANE@example.com' }, deps: h.deps });
  assert.equal(ok.ok, true);
  assert.equal(h.db.tables.submission_threads[0].participant_user_id, GUEST.id);
  assert.equal(h.db.tables.submission_threads[0].participant_name, 'Jane Doe');
  assert.equal((await claimInvite({ token, user: GUEST, deps: h.deps })).ok, true, 'idempotent');
  assert.equal((await claimInvite({ token, user: { ...OTHER, email: 'jane@example.com', id: 'aaaaaaaa-0000-0000-0000-000000000009' }, deps: h.deps })).reason, 'claimed_other');
});

test('changing the invite email revokes earlier links', async () => {
  const h = harness();
  await inviteToConversation({ type: 'venue-inquiries', id: SUB, rawBody: 'Hi', deps: h.deps });
  const first = `tok_${'1'.padStart(30, 'x')}`;
  const res = await inviteToConversation({ type: 'venue-inquiries', id: SUB, rawEmail: 'jane.work@example.com', deps: h.deps });
  assert.equal(res.body.thread.invite_email, 'jane.work@example.com');
  assert.equal((await claimInvite({ token: first, user: GUEST, deps: h.deps })).reason, 'revoked');
  const second = `tok_${'2'.padStart(30, 'x')}`;
  assert.equal((await claimInvite({ token: second, user: { ...OTHER, email: 'jane.work@example.com' }, deps: h.deps })).ok, true);
});

test('team messages before joining email a fresh link; after joining they notify the account', async () => {
  const h = harness();
  await inviteToConversation({ type: 'venue-inquiries', id: SUB, deps: h.deps });
  const before = await postTeamMessage({ type: 'venue-inquiries', id: SUB, rawBody: 'Following up', deps: h.deps });
  assert.equal(before.status, 201);
  assert.equal(before.body.delivery.delivered, 'email');
  assert.equal(h.db.tables.submission_thread_invites.length, 2);

  await claimInvite({ token: `tok_${'2'.padStart(30, 'x')}`, user: GUEST, deps: h.deps });
  const after = await postTeamMessage({ type: 'venue-inquiries', id: SUB, rawBody: 'Got it, thanks', deps: h.deps });
  assert.equal(after.body.delivery.delivered, 'account');
  assert.equal(h.notified.at(-1).userId, GUEST.id);
});

test('guests only see their own thread, answer questions, and alert the admins', async () => {
  const h = harness();
  await inviteToConversation({ type: 'venue-inquiries', id: SUB, rawBody: 'Headcount?', kind: 'question', deps: h.deps });
  const threadId = h.db.tables.submission_threads[0].id;
  // Not yet claimed: invisible to everyone, including the right person.
  assert.equal((await getMyConversation({ threadId: '33333333-3333-3333-3333-333333333333', deps: h.deps })).status, 404);
  h.db.tables.submission_threads[0].id = '44444444-4444-4444-4444-444444444444';
  h.db.tables.submission_thread_messages.forEach((m) => { m.thread_id = '44444444-4444-4444-4444-444444444444'; });
  h.db.tables.submission_thread_invites.forEach((m) => { m.thread_id = '44444444-4444-4444-4444-444444444444'; });
  const tid = '44444444-4444-4444-4444-444444444444';
  assert.notEqual(threadId, tid);
  assert.equal((await getMyConversation({ threadId: tid, deps: h.deps })).status, 404);

  await claimInvite({ token: `tok_${'1'.padStart(30, 'x')}`, user: GUEST, deps: h.deps });
  assert.equal((await getMyConversation({ threadId: tid, deps: h.as({ getUser: async () => OTHER }) })).status, 404, 'someone else cannot read it');

  const view = await getMyConversation({ threadId: tid, deps: h.deps });
  assert.equal(view.status, 200);
  assert.equal(view.body.conversation.unread, false, 'opening the thread reads it');
  const question = view.body.messages[0];
  assert.equal(question.open_question, true);
  assert.equal(h.db.tables.submission_threads[0].unread_by_guest, undefined, 'derived, not stored');
  assert.ok(h.db.tables.submission_threads[0].guest_last_read_at, 'opening marks it read');

  const bad = await postGuestMessage({ threadId: tid, rawBody: 'x', replyToId: 'not-a-question', deps: h.deps });
  assert.equal(bad.status, 400);

  const before = h.notified.length;
  const answer = await postGuestMessage({ threadId: tid, rawBody: 'About 120 people', replyToId: question.id, deps: h.deps });
  assert.equal(answer.status, 201);
  assert.equal(answer.body.message.author_name, 'Jane Doe');
  const admins = h.notified.slice(before);
  assert.deepEqual(admins.map((n) => n.userId), [ADAM.id, JEYU.id]);
  assert.equal(admins[0].type, 'admin_conversation_reply');
  assert.match(admins[0].data.url, /^\/bananas\/venue-inquiries\/.+#conversation$/);

  const after = await getMyConversation({ threadId: tid, deps: h.deps });
  assert.equal(after.body.messages[0].open_question, false);

  const team = await getTeamConversation({ type: 'venue-inquiries', id: SUB, deps: h.deps });
  assert.equal(team.body.thread.awaiting_team, false, 'viewing marks replies read for the team');

  const list = await listMyConversations({ deps: h.deps });
  assert.equal(list.body.conversations.length, 1);
  assert.equal(list.body.conversations[0].open_questions, 0);
  assert.equal((await listMyConversations({ deps: h.as({ getUser: async () => OTHER }) })).body.conversations.length, 0);
});

test('closed conversations are read-only for the submitter and the team composer', async () => {
  const h = harness();
  await inviteToConversation({ type: 'applications', id: APP, rawBody: 'Hi', deps: h.deps });
  h.db.tables.submission_threads[0].id = '55555555-5555-5555-5555-555555555555';
  h.db.tables.submission_thread_messages.forEach((m) => { m.thread_id = '55555555-5555-5555-5555-555555555555'; });
  assert.equal((await setConversationStatus({ type: 'applications', id: APP, status: 'closed', deps: h.deps })).status, 200);
  assert.equal((await postGuestMessage({ threadId: '55555555-5555-5555-5555-555555555555', rawBody: 'hello?', deps: h.deps })).status, 409);
  assert.equal((await postTeamMessage({ type: 'applications', id: APP, rawBody: 'x', deps: h.deps })).status, 409);
  assert.equal((await setConversationStatus({ type: 'applications', id: APP, status: 'open', deps: h.deps })).status, 200);
  assert.equal((await postGuestMessage({ threadId: '55555555-5555-5555-5555-555555555555', rawBody: 'hello?', deps: h.deps })).status, 201);
});

test('team messages: author or owner deletes; guest messages cannot be deleted', async () => {
  const h = harness({ viewer: JEYU });
  await inviteToConversation({ type: 'applications', id: APP, rawBody: 'From Jeyu', deps: h.deps });
  const msgId = h.db.tables.submission_thread_messages[0].id;
  h.db.tables.submission_threads[0].id = '66666666-6666-6666-6666-666666666666';
  h.db.tables.submission_thread_messages.forEach((m) => { m.thread_id = '66666666-6666-6666-6666-666666666666'; });
  await postGuestMessage({ threadId: '66666666-6666-6666-6666-666666666666', rawBody: 'Hi Jeyu', deps: h.deps });
  const guestMsgId = h.db.tables.submission_thread_messages[1].id;

  const otherAdmin = h.as({ requireAdminMfa: async () => ({ user: { id: 'u-third', email: 'third@sdgatx.com' } }) });
  assert.equal((await deleteTeamMessage({ type: 'applications', id: APP, messageId: msgId, deps: otherAdmin })).status, 403);
  const owner = h.as({ requireAdminMfa: async () => ({ user: ADAM }) });
  assert.equal((await deleteTeamMessage({ type: 'applications', id: APP, messageId: guestMsgId, deps: owner })).status, 403);
  assert.equal((await deleteTeamMessage({ type: 'applications', id: APP, messageId: msgId, deps: owner })).status, 200);
  assert.ok(h.db.tables.submission_thread_messages[0].deleted_at, 'soft delete keeps the row');
  const view = await getMyConversation({ threadId: '66666666-6666-6666-6666-666666666666', deps: h.deps });
  assert.equal(view.body.messages.length, 1, 'deleted message hidden from the submitter');
});
