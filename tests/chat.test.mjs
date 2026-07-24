import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  channelDisplayName,
  channelHasUnread,
  lastMessagePerChannel,
} from '../lib/chat.js';

const ME = 'user-me';
const OTHER = 'user-other';

test('channelDisplayName: group channel uses its name', () => {
  const ch = { id: 'c1', type: 'channel', name: 'General' };
  assert.equal(channelDisplayName(ch, [], {}, ME), 'General');
});

test('channelDisplayName: DM resolves the counterpart team member name', () => {
  const ch = { id: 'd1', type: 'dm', name: null };
  const roster = [
    { channel_id: 'd1', user_id: ME },
    { channel_id: 'd1', user_id: OTHER },
  ];
  const teamByUserId = { [OTHER]: { user_id: OTHER, full_name: 'Jamie Rivera', email: 'j@x.com' } };
  assert.equal(channelDisplayName(ch, roster, teamByUserId, ME), 'Jamie Rivera');
});

test('channelDisplayName: DM falls back to email then generic label', () => {
  const ch = { id: 'd1', type: 'dm', name: null };
  const roster = [
    { channel_id: 'd1', user_id: ME },
    { channel_id: 'd1', user_id: OTHER },
  ];
  assert.equal(
    channelDisplayName(ch, roster, { [OTHER]: { user_id: OTHER, email: 'j@x.com' } }, ME),
    'j@x.com'
  );
  assert.equal(channelDisplayName(ch, roster, {}, ME), 'Direct Message');
});

test('channelHasUnread: no messages means read', () => {
  assert.equal(channelHasUnread(null, null, ME), false);
});

test('channelHasUnread: own latest message never counts as unread', () => {
  const last = { created_at: '2026-07-24T10:00:00Z', sender_id: ME };
  assert.equal(channelHasUnread(last, '2026-07-24T09:00:00Z', ME), false);
});

test('channelHasUnread: no last_read_at with a message from someone else is unread', () => {
  const last = { created_at: '2026-07-24T10:00:00Z', sender_id: OTHER };
  assert.equal(channelHasUnread(last, null, ME), true);
});

test('channelHasUnread: message newer than last_read_at is unread', () => {
  const last = { created_at: '2026-07-24T10:00:00Z', sender_id: OTHER };
  assert.equal(channelHasUnread(last, '2026-07-24T09:59:59Z', ME), true);
});

test('channelHasUnread: message older than or equal to last_read_at is read', () => {
  const last = { created_at: '2026-07-24T10:00:00Z', sender_id: OTHER };
  assert.equal(channelHasUnread(last, '2026-07-24T10:00:00Z', ME), false);
  assert.equal(channelHasUnread(last, '2026-07-24T11:00:00Z', ME), false);
});

test('lastMessagePerChannel: keeps the most-recent message per channel', () => {
  const msgs = [
    { channel_id: 'c1', sender_id: OTHER, created_at: '2026-07-24T10:00:00Z' },
    { channel_id: 'c1', sender_id: ME, created_at: '2026-07-24T12:00:00Z' },
    { channel_id: 'c2', sender_id: OTHER, created_at: '2026-07-24T08:00:00Z' },
  ];
  const out = lastMessagePerChannel(msgs);
  assert.equal(out.c1.created_at, '2026-07-24T12:00:00Z');
  assert.equal(out.c1.sender_id, ME);
  assert.equal(out.c2.created_at, '2026-07-24T08:00:00Z');
});

test('lastMessagePerChannel: handles empty/undefined input', () => {
  assert.deepEqual(lastMessagePerChannel([]), {});
  assert.deepEqual(lastMessagePerChannel(undefined), {});
});
