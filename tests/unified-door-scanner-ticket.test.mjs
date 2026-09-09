import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression guard: the front-desk UnifiedDoorScanner has to handle three
// preview sources (member_id, trial_pass, ticket). A prior build only had
// member_id + trial_pass in buildPreviewVM/commitAdmit/commitReject, so a
// scanned ticket QR fell through to trial_pass and the check-in path posted
// the ticket code to /api/capacity/trial-pass/scan, which returned
// "That is not an SDG trial pass" at the door. Keep the ticket branches
// wired end-to-end so that regression can't come back silently.

const src = readFileSync(
  new URL('../app/capacity/components/UnifiedDoorScanner.js', import.meta.url),
  'utf8',
);

test('buildPreviewVM has a ticket branch that returns source:"ticket"', () => {
  // The ticket branch must fire BEFORE the trial_pass fall-through, or a
  // ticket QR still ends up mis-labeled as a trial pass in the VM.
  const buildIdx = src.indexOf('function buildPreviewVM(');
  assert.ok(buildIdx > 0, 'buildPreviewVM not found');
  const body = src.slice(buildIdx, buildIdx + 3000);
  const ticketBranchIdx = body.indexOf("if (source === 'ticket')");
  const memberBranchIdx = body.indexOf("if (source === 'member_id')");
  assert.ok(ticketBranchIdx > 0, 'no ticket branch in buildPreviewVM');
  assert.ok(memberBranchIdx > 0, 'no member_id branch in buildPreviewVM');
  assert.ok(
    ticketBranchIdx < memberBranchIdx,
    'ticket branch must be checked before member_id so it cannot fall through',
  );
  assert.match(body, /source: 'ticket'/);
  assert.match(body, /token: requestBody\.code/);
});

test('commitAdmit routes ticket previews to /api/tickets/scan with mode:"checkin"', () => {
  // Two ways this could regress: (1) the endpoint helper forgets ticket, or
  // (2) the body helper forgets to send mode:"checkin" for ticket admits.
  assert.match(src, /function endpointFor\(source\)/);
  assert.match(src, /if \(source === 'ticket'\) return '\/api\/tickets\/scan'/);
  assert.match(
    src,
    /if \(source === 'ticket'\) \{[\s\S]{0,400}code: preview\.token, mode: action === 'admit' \? 'checkin' : 'reject'/,
  );
});

test('commitAdmit treats ticket result "valid" and "override" as admitted', () => {
  assert.match(
    src,
    /preview\.source === 'ticket' && \(json\.result === 'valid' \|\| json\.result === 'override'\)/,
  );
});

test('reject reasons for tickets use the ticket-specific bank', () => {
  assert.match(src, /REJECT_REASONS_TICKET/);
  assert.match(src, /function reasonsFor\(source\)/);
  assert.match(src, /if \(source === 'ticket'\) return REJECT_REASONS_TICKET/);
});

test('FrontDeskClient recent-activity label knows about ticket scans', () => {
  const front = readFileSync(
    new URL('../app/capacity/front-desk/FrontDeskClient.js', import.meta.url),
    'utf8',
  );
  assert.match(front, /ticket: 'Ticket'/);
});
