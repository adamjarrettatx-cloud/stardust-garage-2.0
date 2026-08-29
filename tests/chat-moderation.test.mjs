import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canModerateChat, canCreateChatChannel, channelDeleteConfirmed } from '../lib/chat.js';

// Owner-only chat moderation (2026-08-29). The rule the owner asked for is
// absolute: he can delete any message anywhere in Team Chat, and nobody else can
// delete anything — not even their own message. These tests pin both halves,
// because the failure mode is silent: a permissive policy or a stray sender
// check would simply hand deletion back to the whole team with nothing visibly
// broken.

const migration = readFileSync(
  new URL('../supabase/migrations/20260829_chat_owner_only_moderation.sql', import.meta.url),
  'utf8'
);
const messageRoute = readFileSync(
  new URL('../app/api/team/chat/messages/[id]/route.js', import.meta.url),
  'utf8'
);
const channelRoute = readFileSync(
  new URL('../app/api/team/chat/channels/[id]/route.js', import.meta.url),
  'utf8'
);
const client = readFileSync(new URL('../app/team/chat/TeamChatClient.js', import.meta.url), 'utf8');
const chatPage = readFileSync(new URL('../app/team/chat/page.js', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Who may moderate
// ---------------------------------------------------------------------------

test('canModerateChat: either owner address with the admin role may moderate', () => {
  assert.equal(canModerateChat({ role: 'admin', email: 'admin@sdgatx.com' }), true);
  assert.equal(canModerateChat({ role: 'admin', email: 'adam@sdgatx.com' }), true);
  assert.equal(canModerateChat({ role: 'admin', email: '  Admin@SDGatx.com ' }), true);
});

test('canModerateChat: no other admin, team member or unknown caller may moderate', () => {
  assert.equal(canModerateChat({ role: 'admin', email: 'jeyu@sdgatx.com' }), false);
  assert.equal(canModerateChat({ role: 'team', email: 'admin@sdgatx.com' }), false);
  assert.equal(canModerateChat({ role: 'team', email: 'david@sdgatx.com' }), false);
  assert.equal(canModerateChat({}), false);
  assert.equal(canModerateChat(), false);
});

test('creating a channel and moderating are the same authority, not two rules', () => {
  for (const actor of [
    { role: 'admin', email: 'admin@sdgatx.com' },
    { role: 'admin', email: 'jeyu@sdgatx.com' },
    { role: 'team', email: 'david@sdgatx.com' },
    {},
  ]) {
    assert.equal(canCreateChatChannel(actor), canModerateChat(actor));
  }
});

// ---------------------------------------------------------------------------
// Channel-delete confirmation
// ---------------------------------------------------------------------------

test('channelDeleteConfirmed: accepts the name typed back, ignoring # / case / space', () => {
  assert.equal(channelDeleteConfirmed('general', 'general'), true);
  assert.equal(channelDeleteConfirmed('#general', 'general'), true);
  assert.equal(channelDeleteConfirmed('  General  ', 'general'), true);
  assert.equal(channelDeleteConfirmed('# general', 'general'), true);
});

test('channelDeleteConfirmed: rejects anything that is not the name', () => {
  assert.equal(channelDeleteConfirmed('genera', 'general'), false);
  assert.equal(channelDeleteConfirmed('general-2', 'general'), false);
  assert.equal(channelDeleteConfirmed('delete', 'general'), false);
  assert.equal(channelDeleteConfirmed('', 'general'), false);
  assert.equal(channelDeleteConfirmed(null, 'general'), false);
});

test('channelDeleteConfirmed: an unnamed channel can never be confirmed', () => {
  // A DM has no name. Empty input must not match empty target and wave a delete
  // through, which is what a naive equality check would do.
  assert.equal(channelDeleteConfirmed('', null), false);
  assert.equal(channelDeleteConfirmed('', ''), false);
  assert.equal(channelDeleteConfirmed('#', undefined), false);
});

// ---------------------------------------------------------------------------
// Migration contract
// ---------------------------------------------------------------------------

test('migration removes the policy that let senders delete their own messages', () => {
  assert.match(
    migration,
    /drop policy if exists "senders can edit or soft-delete their own messages" on public\.chat_messages/
  );
});

test('migration removes the policy that let members leave a channel', () => {
  assert.match(
    migration,
    /drop policy if exists "members can leave a channel" on public\.chat_channel_members/
  );
});

test('migration gates every destructive chat policy on the owner-only function', () => {
  for (const policy of [
    'chat_messages_update_owner_only',
    'chat_messages_delete_owner_only',
    'chat_channels_delete_owner_only',
    'chat_channel_members_delete_owner_only',
  ]) {
    assert.match(migration, new RegExp(`create policy ${policy} on`));
  }
  // Nothing may authorize a delete on sender identity or plain membership.
  const policyBody = migration.replace(/^\s*--.*$/gm, '');
  assert.doesNotMatch(policyBody, /sender_id = auth\.uid\(\)/);
  assert.doesNotMatch(policyBody, /is_channel_member/);
});

test('migration pairs each owner-only policy with a restrictive backstop', () => {
  const restrictive = migration.match(/as restrictive for (?:update|delete)/g) || [];
  assert.ok(restrictive.length >= 4, `expected 4+ restrictive policies, found ${restrictive.length}`);
});

test('migration publishes chat_channels for realtime so deletes propagate', () => {
  assert.match(migration, /alter publication supabase_realtime add table public\.chat_channels/);
});

test('migration records who deleted a message', () => {
  assert.match(migration, /add column if not exists deleted_by uuid references auth\.users\(id\)/);
});

// ---------------------------------------------------------------------------
// Route contract
// ---------------------------------------------------------------------------

test('the message delete route is gated and soft-deletes rather than dropping the row', () => {
  assert.match(messageRoute, /requireChatChannelAdmin\(\)/);
  assert.match(messageRoute, /status: 401/);
  assert.match(messageRoute, /deleted_at: new Date\(\)\.toISOString\(\)/);
  assert.match(messageRoute, /deleted_by: user\.id/);
  // "Gone without a trace" means the text goes too, not just the visibility.
  assert.match(messageRoute, /body: null/);
});

test('the message delete route never narrows the target to the caller', () => {
  // Any sender's message, in any channel or DM, is deletable by the owner.
  assert.doesNotMatch(messageRoute, /sender_id/);
});

test('the message delete route clears the attachment from private storage', () => {
  assert.match(messageRoute, /storage\.from\('chat-images'\)\.remove/);
});

test('the channel delete route is gated and requires the typed name', () => {
  assert.match(channelRoute, /requireChatChannelAdmin\(\)/);
  assert.match(channelRoute, /status: 401/);
  assert.match(channelRoute, /channelDeleteConfirmed\(body\?\.confirm, channel\.name\)/);
});

test('the channel delete route refuses DM threads', () => {
  assert.match(channelRoute, /channel\.type !== 'channel'/);
});

test('the channel delete route empties storage before the cascade removes the rows', () => {
  const removeAt = channelRoute.indexOf(".remove(");
  const deleteAt = channelRoute.indexOf(".from('chat_channels').delete()");
  assert.ok(removeAt > -1 && deleteAt > -1);
  assert.ok(removeAt < deleteAt, 'attachments must be cleared before the channel row is deleted');
});

// ---------------------------------------------------------------------------
// UI contract
// ---------------------------------------------------------------------------

test('the chat page computes moderation authority on the server', () => {
  assert.match(chatPage, /canModerate=\{canModerateChat\(\{ role: teamMember\.role, email: user\.email \}\)\}/);
});

test('every delete affordance in the client is behind canModerate', () => {
  assert.match(client, /canModerate && \(/);
  assert.match(client, /onDelete=\{canModerate \?/);
});

test('deleting a message takes two clicks', () => {
  assert.match(client, /armedDeleteId === m\.id/);
  assert.match(client, /CONFIRM DELETE/);
});

test('the client listens for deletions so they reach other open windows', () => {
  assert.match(client, /event: 'UPDATE', schema: 'public', table: 'chat_messages'/);
  assert.match(client, /event: 'DELETE', schema: 'public', table: 'chat_channels'/);
});
