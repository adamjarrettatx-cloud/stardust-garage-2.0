import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Pin the contract of the one-scan combined-checkin behavior. When a
// member (or trial-member) scans their Member ID at the door and the
// scanner is bound to a specific event, the same verify call must
// atomically redeem any valid ticket the member holds for that event AND
// log the member scan \u2014 one scan, one tap, both credentials cleared.
//
// This test file is intentionally source-level to avoid spinning up
// Supabase in CI. It guards the important invariants a refactor could
// silently break.

const routeSrc = readFileSync(
  new URL('../app/api/scan/member-id/route.js', import.meta.url),
  'utf8',
);
const helperSrc = readFileSync(
  new URL('../lib/member-id-linked-ticket.js', import.meta.url),
  'utf8',
);
const uiSrc = readFileSync(
  new URL('../app/scan/UnifiedScanClient.js', import.meta.url),
  'utf8',
);

// ---- Route wiring ----

test('member-id route imports the linked-ticket helper', () => {
  assert.match(routeSrc, /findMemberLinkedTicket/);
  assert.match(routeSrc, /from '@\/lib\/member-id-linked-ticket'/);
});

test('preview mode surfaces linked_ticket only when event_id is set', () => {
  const previewBlock = sliceBetween(routeSrc, "if (mode === 'preview')", "if (mode === 'reject')");
  assert.ok(previewBlock, 'expected a preview block');
  assert.match(previewBlock, /eventId\s*\?\s*await findMemberLinkedTicket/);
  assert.match(previewBlock, /linked_ticket:/);
});

test('preview mode still has NO writes (pure read)', () => {
  const previewBlock = sliceBetween(routeSrc, "if (mode === 'preview')", "if (mode === 'reject')");
  assert.equal(/\.insert\(/.test(previewBlock), false, 'preview must not insert rows');
  assert.equal(/\.update\(/.test(previewBlock), false, 'preview must not update rows');
});

test('verify mode redeems linked ticket with the atomic status="valid" WHERE guard', () => {
  // The critical race guard: the ticket flip must be conditional on
  // status='valid' so two doors scanning the same buyer at once can't
  // double-consume the same ticket.
  const verifyBlock = sliceBetween(routeSrc, '// MODE: verify', '  return NextResponse.json({');
  assert.ok(verifyBlock, 'expected a verify block');
  assert.match(verifyBlock, /\.eq\('status',\s*'valid'\)/);
  assert.match(verifyBlock, /update\(\{ status: 'used', used_at:/);
});

test('verify mode logs the ticket-side check-in into ticket_checkins', () => {
  const verifyBlock = sliceBetween(routeSrc, '// MODE: verify', '  return NextResponse.json({');
  assert.match(verifyBlock, /ticket_checkins/);
  assert.match(verifyBlock, /via_member_id/);
});

test('verify mode still logs the member scan even when no ticket is linked', () => {
  // The member scan insert must live OUTSIDE the "if (linkedTicket.ticket)"
  // block \u2014 members without tickets still walk in on their base credential.
  const verifyBlock = sliceBetween(routeSrc, '// MODE: verify', '  return NextResponse.json({');
  const memberInsertIdx = verifyBlock.indexOf("from('member_id_scans')");
  const linkedTicketIdx = verifyBlock.indexOf('if (linkedTicket.ticket)');
  // Matched on the destructuring of the member_id_scans insert, which now also
  // pulls out the inserted row id so the door feed can key the scan.
  const linkedTicketEnd = verifyBlock.indexOf('  }\n\n  const { data: verifyRow, error }');
  assert.ok(memberInsertIdx > 0);
  assert.ok(linkedTicketIdx > 0);
  assert.ok(linkedTicketEnd > 0);
  assert.ok(
    memberInsertIdx > linkedTicketEnd,
    'member_id_scans insert must come after the linked-ticket block closes',
  );
});

test('verify mode returns a ticket outcome payload for the UI', () => {
  const verifyBlock = sliceBetween(routeSrc, '// MODE: verify', /}\s*$/);
  assert.match(verifyBlock, /ticket: ticketOutcome/);
});

// ---- Linked-ticket helper ----

test('helper looks up orders by BOTH member_profile_id and buyer_email', () => {
  assert.match(helperSrc, /\.eq\('member_profile_id', memberProfileId\)/);
  assert.match(helperSrc, /\.ilike\('buyer_email', emailCanon\)/);
});

test('helper filters tickets by event AND valid status', () => {
  assert.match(helperSrc, /\.eq\('event_id', eventId\)/);
  assert.match(helperSrc, /\.eq\('status', 'valid'\)/);
});

test('helper picks the oldest ticket deterministically when multiple exist', () => {
  assert.match(helperSrc, /\.order\('created_at', \{ ascending: true \}\)/);
});

test('helper never throws \u2014 wraps everything in try/catch and returns empty on failure', () => {
  assert.match(helperSrc, /catch \(err\) \{/);
  const catchBlock = helperSrc.slice(helperSrc.indexOf('catch (err)'));
  assert.match(catchBlock, /return empty/);
});

test('helper reports how the match happened for audit', () => {
  assert.match(helperSrc, /const matchedVia = memberOrderIds\.has\(chosen\.order_id\)/);
  assert.match(helperSrc, /'member_profile_id' : 'buyer_email'/);
});

// ---- UI wiring ----

test('scanner UI shows a linked-ticket pill on member-id preview', () => {
  // After the trial-pass follow-up the guard covers both kinds; the pill
  // still fires for member_id \u2014 assert that member_id is one of the
  // covered kinds and that the WILL CHECK IN label is present.
  assert.match(uiSrc, /kind === 'member_id'[\s\S]{0,80}preview\?\.data\?\.linked_ticket/);
  assert.match(uiSrc, /WILL CHECK IN/);
});

test('scanner UI switches verify button label to combined action', () => {
  assert.match(uiSrc, /verifyLabelForPreview\(preview\)/);
  assert.match(uiSrc, /'Verify \+ Check In'/);
});

test('scanner UI acknowledges the ticket in the result card', () => {
  assert.match(uiSrc, /ticket\.result === 'valid'/);
  assert.match(uiSrc, /checked in/);
  assert.match(uiSrc, /already used/);
});

// ---- helpers ----
function sliceBetween(source, startMarker, endMarker) {
  const startIdx =
    typeof startMarker === 'string' ? source.indexOf(startMarker) : source.search(startMarker);
  if (startIdx < 0) return null;
  const rest = source.slice(startIdx);
  const endIdx = typeof endMarker === 'string' ? rest.indexOf(endMarker) : rest.search(endMarker);
  return endIdx < 0 ? rest : rest.slice(0, endIdx);
}
