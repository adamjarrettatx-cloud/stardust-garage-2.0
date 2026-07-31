import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  channelDisplayName,
  unreadCountByChannel,
  totalUnreadCount,
  canCreateChatChannel,
  validateChannelName,
  CHANNEL_NAME_MAX_LENGTH,
  validateChatImageFile,
  CHAT_IMAGE_MAX_BYTES,
  buildChatImagePath,
  replyPreviewText,
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

// ---------------------------------------------------------------------------
// Unread counts
// ---------------------------------------------------------------------------

test('unreadCountByChannel: keys channels by their count', () => {
  const rows = [
    { channel_id: 'c1', unread_count: 3 },
    { channel_id: 'd1', unread_count: 1 },
  ];
  assert.deepEqual(unreadCountByChannel(rows), { c1: 3, d1: 1 });
});

test('unreadCountByChannel: omits fully-read channels so a missing key means read', () => {
  const rows = [
    { channel_id: 'c1', unread_count: 0 },
    { channel_id: 'c2', unread_count: 2 },
  ];
  const out = unreadCountByChannel(rows);
  assert.equal('c1' in out, false);
  assert.equal(out.c2, 2);
});

test('unreadCountByChannel: coerces string counts and tolerates empty input', () => {
  // PostgREST can hand back bigint-ish values as strings.
  assert.deepEqual(unreadCountByChannel([{ channel_id: 'c1', unread_count: '4' }]), { c1: 4 });
  assert.deepEqual(unreadCountByChannel([]), {});
  assert.deepEqual(unreadCountByChannel(null), {});
  assert.deepEqual(unreadCountByChannel(undefined), {});
});

test('totalUnreadCount: sums every channel and DM into the nav badge number', () => {
  const rows = [
    { channel_id: 'c1', unread_count: 3 },
    { channel_id: 'c2', unread_count: 0 },
    { channel_id: 'd1', unread_count: '8' },
  ];
  assert.equal(totalUnreadCount(rows), 11);
});

test('totalUnreadCount: is 0 when nothing is unread or the RPC returned nothing', () => {
  assert.equal(totalUnreadCount([{ channel_id: 'c1', unread_count: 0 }]), 0);
  assert.equal(totalUnreadCount([]), 0);
  assert.equal(totalUnreadCount(null), 0);
  assert.equal(totalUnreadCount(undefined), 0);
});

// ---------------------------------------------------------------------------
// Channel creation gate
// ---------------------------------------------------------------------------

test('canCreateChatChannel: the owner account may create channels', () => {
  assert.equal(canCreateChatChannel({ role: 'admin', email: 'admin@sdgatx.com' }), true);
  assert.equal(canCreateChatChannel({ role: 'admin', email: 'adam@sdgatx.com' }), true);
});

test('canCreateChatChannel: owner email match is case- and whitespace-insensitive', () => {
  assert.equal(canCreateChatChannel({ role: 'admin', email: '  Admin@SDGatx.com ' }), true);
});

test('canCreateChatChannel: another admin may NOT create channels', () => {
  // The gate is owner-only, not role-wide — a second admin is still refused.
  assert.equal(canCreateChatChannel({ role: 'admin', email: 'jeyu@sdgatx.com' }), false);
});

test('canCreateChatChannel: the owner email without the admin role is refused', () => {
  // Guards against someone signing up an account at the owner address without
  // a matching server-controlled team_members row.
  assert.equal(canCreateChatChannel({ role: 'team', email: 'admin@sdgatx.com' }), false);
  assert.equal(canCreateChatChannel({ role: null, email: 'admin@sdgatx.com' }), false);
});

test('canCreateChatChannel: a plain team member and an unknown caller are refused', () => {
  assert.equal(canCreateChatChannel({ role: 'team', email: 'david@sdgatx.com' }), false);
  assert.equal(canCreateChatChannel({}), false);
  assert.equal(canCreateChatChannel(), false);
});

// ---------------------------------------------------------------------------
// Channel name validation
// ---------------------------------------------------------------------------

test('validateChannelName: normalizes to a lowercase hyphenated slug', () => {
  assert.deepEqual(validateChannelName('  Website Ideas  '), {
    valid: true,
    name: 'website-ideas',
    error: null,
  });
  assert.equal(validateChannelName('#Front Desk!').name, 'front-desk');
  assert.equal(validateChannelName('a___b').name, 'a-b');
});

test('validateChannelName: rejects names that normalize to fewer than 2 characters', () => {
  for (const raw of ['', '   ', '#', 'x', '!!!', null, undefined]) {
    assert.equal(validateChannelName(raw).valid, false, `expected ${JSON.stringify(raw)} to be invalid`);
  }
});

test('validateChannelName: rejects names over the length limit', () => {
  const tooLong = 'a'.repeat(CHANNEL_NAME_MAX_LENGTH + 1);
  const result = validateChannelName(tooLong);
  assert.equal(result.valid, false);
  assert.match(result.error, /40 characters or fewer/);

  assert.equal(validateChannelName('a'.repeat(CHANNEL_NAME_MAX_LENGTH)).valid, true);
});

// ---------------------------------------------------------------------------
// Image attachments
// ---------------------------------------------------------------------------

test('validateChatImageFile: accepts an in-range image of an allowed type', () => {
  const file = { type: 'image/png', size: 1024 };
  assert.deepEqual(validateChatImageFile(file), { valid: true, error: null });
});

test('validateChatImageFile: rejects a missing file', () => {
  assert.equal(validateChatImageFile(null).valid, false);
  assert.equal(validateChatImageFile(undefined).valid, false);
});

test('validateChatImageFile: rejects disallowed mime types', () => {
  const file = { type: 'application/pdf', size: 1024 };
  const result = validateChatImageFile(file);
  assert.equal(result.valid, false);
  assert.match(result.error, /JPG, PNG, WEBP, or GIF/);
});

test('validateChatImageFile: rejects files over the 10MB bucket limit', () => {
  const file = { type: 'image/jpeg', size: CHAT_IMAGE_MAX_BYTES + 1 };
  const result = validateChatImageFile(file);
  assert.equal(result.valid, false);
  assert.match(result.error, /10MB/);

  // Exactly at the limit is still fine.
  assert.equal(validateChatImageFile({ type: 'image/jpeg', size: CHAT_IMAGE_MAX_BYTES }).valid, true);
});

test('buildChatImagePath: nests the object under the channel id, preserving a lowercased extension', () => {
  const path = buildChatImagePath('c1', 'My Flier.PNG');
  assert.match(path, /^c1\/\d+-[a-z0-9]+\.png$/);
});

test('buildChatImagePath: falls back to jpg for a missing or unusual extension', () => {
  assert.match(buildChatImagePath('c1', 'noextension'), /^c1\/\d+-[a-z0-9]+\.jpg$/);
  assert.match(buildChatImagePath('c1', ''), /^c1\/\d+-[a-z0-9]+\.jpg$/);
});

test('buildChatImagePath: two calls for the same file produce different paths', () => {
  const a = buildChatImagePath('c1', 'flier.jpg');
  const b = buildChatImagePath('c1', 'flier.jpg');
  assert.notEqual(a, b);
});

// ---------------------------------------------------------------------------
// Reply-to previews
// ---------------------------------------------------------------------------

test('replyPreviewText: returns the trimmed body for a text message', () => {
  assert.equal(replyPreviewText({ body: '  see you at 9  ' }), 'see you at 9');
});

test('replyPreviewText: truncates long bodies to 140 characters plus an ellipsis', () => {
  const long = 'x'.repeat(200);
  const result = replyPreviewText({ body: long });
  assert.equal(result.length, 141);
  assert.ok(result.endsWith('…'));
});

test('replyPreviewText: falls back to a photo label for an image-only message', () => {
  assert.equal(replyPreviewText({ body: '', image_path: 'c1/a.png' }), '📷 Photo');
  assert.equal(replyPreviewText({ body: '   ', image_path: 'c1/a.png' }), '📷 Photo');
});

test('replyPreviewText: returns null when the message is unavailable', () => {
  assert.equal(replyPreviewText(null), null);
  assert.equal(replyPreviewText(undefined), null);
  assert.equal(replyPreviewText({ body: 'gone now', deleted_at: '2026-01-01T00:00:00Z' }), null);
  assert.equal(replyPreviewText({ body: '', image_path: null }), null);
});
