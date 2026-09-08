import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getActiveDoorSession,
  loadOpenableEvent,
  openDoorSession,
  closeActiveDoorSession,
  MAX_DOOR_SESSION_NOTES,
} from '../lib/door-session.js';

// A tiny in-memory Supabase-shaped mock. Each call returns a chain object
// exposing the subset of methods the helpers actually use.

function chain(result) {
  const obj = {
    select: () => obj,
    eq: () => obj,
    is: () => obj,
    order: () => obj,
    limit: () => obj,
    maybeSingle: async () => result,
    single: async () => result,
  };
  return obj;
}

function mockAdmin({
  activeSession = null,
  event = null,
  insertResult = { data: { id: 'sess-new', event_id: 'evt-1', opened_at: 't0', opened_by: 'u1', closed_at: null, notes: null }, error: null },
  updateResult = { data: { id: 'sess-1', event_id: 'evt-1', opened_at: 't0', opened_by: 'u1', closed_at: 't1', closed_by: 'u2', notes: null }, error: null },
} = {}) {
  const calls = { inserts: [], updates: [] };
  return {
    calls,
    from(table) {
      if (table === 'door_sessions') {
        return {
          // read path — active session lookup
          select() {
            return {
              is: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: activeSession, error: null }),
                  }),
                }),
              }),
            };
          },
          insert(row) {
            calls.inserts.push(row);
            return {
              select: () => ({
                single: async () => insertResult,
              }),
            };
          },
          update(patch) {
            calls.updates.push(patch);
            return {
              eq: () => ({
                is: () => ({
                  select: () => ({
                    maybeSingle: async () => updateResult,
                  }),
                }),
              }),
            };
          },
        };
      }
      if (table === 'events') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: event, error: null }),
            }),
          }),
        };
      }
      return chain({ data: null, error: null });
    },
  };
}

test('getActiveDoorSession returns null when nothing is open', async () => {
  const admin = mockAdmin({ activeSession: null });
  const result = await getActiveDoorSession(admin);
  assert.equal(result, null);
});

test('getActiveDoorSession returns the row when a session is open', async () => {
  const active = { id: 's1', event_id: 'e1', opened_at: 't', opened_by: 'u', closed_at: null, notes: null };
  const admin = mockAdmin({ activeSession: active });
  const result = await getActiveDoorSession(admin);
  assert.deepEqual(result, active);
});

test('loadOpenableEvent rejects missing event_id', async () => {
  const admin = mockAdmin();
  const result = await loadOpenableEvent(admin, '');
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});

test('loadOpenableEvent returns 404 when event not found', async () => {
  const admin = mockAdmin({ event: null });
  const result = await loadOpenableEvent(admin, 'evt-x');
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test('loadOpenableEvent rejects archived events', async () => {
  const admin = mockAdmin({ event: { id: 'e', title: 't', event_date: 'd', status: 'archived' } });
  const result = await loadOpenableEvent(admin, 'e');
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test('loadOpenableEvent allows past events (rescheduled/late door)', async () => {
  const admin = mockAdmin({ event: { id: 'e', title: 't', event_date: '1999-01-01', status: 'published' } });
  const result = await loadOpenableEvent(admin, 'e');
  assert.equal(result.ok, true);
});

test('openDoorSession refuses when a session is already open', async () => {
  const active = { id: 's1', event_id: 'e1', opened_at: 't', opened_by: 'u', closed_at: null };
  const admin = mockAdmin({ activeSession: active });
  const result = await openDoorSession(admin, { eventId: 'e2', openedBy: 'u' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.activeSession.id, 's1');
});

test('openDoorSession happy path inserts and returns the row', async () => {
  const admin = mockAdmin({
    event: { id: 'evt-1', title: 'Show', event_date: '2026-09-12', status: 'published' },
  });
  const result = await openDoorSession(admin, { eventId: 'evt-1', openedBy: 'u1', notes: '  starting doors  ' });
  assert.equal(result.ok, true);
  assert.equal(result.event.id, 'evt-1');
  assert.equal(admin.calls.inserts.length, 1);
  assert.equal(admin.calls.inserts[0].event_id, 'evt-1');
  assert.equal(admin.calls.inserts[0].opened_by, 'u1');
  assert.equal(admin.calls.inserts[0].notes, 'starting doors');
});

test('openDoorSession truncates oversized notes', async () => {
  const admin = mockAdmin({
    event: { id: 'evt-1', title: 'Show', event_date: '2026-09-12', status: 'published' },
  });
  const longNote = 'x'.repeat(MAX_DOOR_SESSION_NOTES + 200);
  await openDoorSession(admin, { eventId: 'evt-1', openedBy: 'u1', notes: longNote });
  assert.equal(admin.calls.inserts[0].notes.length, MAX_DOOR_SESSION_NOTES);
});

test('openDoorSession converts unique-index race (23505) into a 409', async () => {
  const admin = mockAdmin({
    event: { id: 'evt-1', title: 'Show', event_date: '2026-09-12', status: 'published' },
    insertResult: { data: null, error: { code: '23505' } },
  });
  const result = await openDoorSession(admin, { eventId: 'evt-1', openedBy: 'u1' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test('closeActiveDoorSession is idempotent when nothing is open', async () => {
  const admin = mockAdmin({ activeSession: null });
  const result = await closeActiveDoorSession(admin, { closedBy: 'u2' });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyClosed, true);
  assert.equal(admin.calls.updates.length, 0);
});

test('closeActiveDoorSession closes the open session', async () => {
  const active = { id: 's1', event_id: 'e1', opened_at: 't', opened_by: 'u', closed_at: null, notes: null };
  const admin = mockAdmin({ activeSession: active });
  const result = await closeActiveDoorSession(admin, { closedBy: 'u2', notes: 'last call' });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyClosed, false);
  assert.equal(admin.calls.updates.length, 1);
  assert.equal(admin.calls.updates[0].closed_by, 'u2');
  assert.ok(admin.calls.updates[0].notes.includes('[close] last call'));
});
