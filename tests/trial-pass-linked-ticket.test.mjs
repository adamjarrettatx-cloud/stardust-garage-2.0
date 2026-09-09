// Source-level regression tests for the one-scan combined check-in feature
// on the trial-pass side. Mirrors tests/member-id-linked-ticket.test.mjs.
//
// We assert the shape of the route + helper + client, not runtime behavior,
// because there is no local Supabase spin-up in this repo. If any of these
// assertions fail it means the wiring drifted and the door will stop
// double-redeeming as intended.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

const ROUTE = read('app/api/capacity/trial-pass/scan/route.js');
const HELPER = read('lib/trial-pass-linked-ticket.js');
const CLIENT = read('app/scan/UnifiedScanClient.js');

// ---------------------------------------------------------------------------
// Route wiring
// ---------------------------------------------------------------------------

test('trial-pass route imports the linked-ticket helper', () => {
  assert.match(
    ROUTE,
    /import\s+\{\s*findTrialPassLinkedTicket\s*\}\s+from\s+['"]@\/lib\/trial-pass-linked-ticket['"]/,
    'expected findTrialPassLinkedTicket import',
  );
});

test('trial-pass route imports CHECKIN_RESULTS for atomic outcome codes', () => {
  assert.match(
    ROUTE,
    /import\s+\{[^}]*CHECKIN_RESULTS[^}]*\}\s+from\s+['"]@\/lib\/tickets\/checkin\.js['"]/,
    'expected CHECKIN_RESULTS import from tickets/checkin',
  );
});

test('trial-pass row select pulls member_profile_id (both initial + activation SELECT)', () => {
  const matches = ROUTE.match(/member_profile_id/g) || [];
  assert.ok(matches.length >= 3, `expected member_profile_id to appear at least 3x (2 selects + 1 helper call), got ${matches.length}`);
});

// ---------------------------------------------------------------------------
// Preview mode invariants
// ---------------------------------------------------------------------------

test('preview mode looks up linked ticket only when decision.allowed && eventId', () => {
  assert.match(
    ROUTE,
    /decision\.allowed\s*&&\s*eventId[\s\S]*?findTrialPassLinkedTicket/,
    'linked-ticket lookup in preview must be gated on allowed + event',
  );
});

test('preview mode surfaces linked_ticket in response body', () => {
  const previewBlock = ROUTE.split("if (mode === 'preview')")[1].split("if (mode === 'reject')")[0];
  assert.match(previewBlock, /linked_ticket:\s*linkedTicket\.ticket/);
  assert.match(previewBlock, /product_label:\s*linkedTicket\.productLabel/);
  assert.match(previewBlock, /matched_via:\s*linkedTicket\.matchedVia/);
});

test('preview mode does NOT write to tickets or ticket_checkins', () => {
  const previewBlock = ROUTE.split("if (mode === 'preview')")[1].split("if (mode === 'reject')")[0];
  assert.doesNotMatch(previewBlock, /\.from\(['"]tickets['"]\)\s*\n?\s*\.update/, 'preview must not update tickets');
  assert.doesNotMatch(previewBlock, /\.from\(['"]ticket_checkins['"]\)\s*\n?\s*\.insert/, 'preview must not insert ticket_checkins');
});

// ---------------------------------------------------------------------------
// Checkin mode invariants
// ---------------------------------------------------------------------------

test('checkin mode redeems ticket only when decision.allowed && eventId', () => {
  assert.match(
    ROUTE,
    /if\s*\(decision\.allowed\s*&&\s*eventId\)\s*\{[\s\S]*?findTrialPassLinkedTicket/,
    'ticket-redemption block must be gated on allowed + event',
  );
});

test('checkin mode uses atomic status=valid race guard', () => {
  const idx = ROUTE.indexOf('findTrialPassLinkedTicket');
  const secondHalf = ROUTE.slice(idx);
  assert.match(
    secondHalf,
    /\.from\(['"]tickets['"]\)[\s\S]*?\.update\(\{\s*status:\s*['"]used['"][\s\S]*?\.eq\(['"]status['"],\s*['"]valid['"]\)/,
    'ticket flip must include .eq("status", "valid") race guard',
  );
});

test('checkin mode logs ticket_checkins row with via_trial_pass note', () => {
  assert.match(ROUTE, /note:\s*flipped[\s\S]*?via_trial_pass \(matched=\$\{linkedTicket\.matchedVia\}\)[\s\S]*?via_trial_pass lost_race/);
});

test('checkin mode returns ticket outcome in response body', () => {
  const returnBlock = ROUTE.split('return NextResponse.json(').pop();
  assert.match(returnBlock, /ticket:\s*ticketOutcome/);
});

test('ticket redemption happens AFTER pass check-in log so pass state is final', () => {
  const logIdx = ROUTE.indexOf("trial_pass_checkins");
  const ticketIdx = ROUTE.indexOf('findTrialPassLinkedTicket');
  // findTrialPassLinkedTicket appears twice: preview + checkin. We want the
  // checkin one, which is the LAST occurrence.
  const lastTicketIdx = ROUTE.lastIndexOf('findTrialPassLinkedTicket');
  assert.ok(logIdx > 0 && lastTicketIdx > logIdx, 'ticket redemption must come after trial_pass_checkins insert');
});

// ---------------------------------------------------------------------------
// Helper invariants
// ---------------------------------------------------------------------------

test('helper matches on both member_profile_id and buyer_email paths', () => {
  assert.match(HELPER, /\.eq\(['"]member_profile_id['"]/);
  assert.match(HELPER, /\.ilike\(['"]buyer_email['"]/);
});

test('helper filters tickets by event and status=valid, oldest first', () => {
  assert.match(HELPER, /\.eq\(['"]event_id['"]/);
  assert.match(HELPER, /\.eq\(['"]status['"],\s*['"]valid['"]/);
  assert.match(HELPER, /\.order\(['"]created_at['"],\s*\{\s*ascending:\s*true/);
});

test('helper reports matchedVia distinguishing member-order from email-order', () => {
  assert.match(HELPER, /matchedVia\s*=\s*memberOrderIds\.has\(chosen\.order_id\)/);
  assert.match(HELPER, /['"]member_profile_id['"]\s*:\s*['"]buyer_email['"]/);
});

test('helper looks up product name from ticket_products (not event_products)', () => {
  assert.match(HELPER, /\.from\(['"]ticket_products['"]\)/);
  assert.doesNotMatch(HELPER, /\.from\(['"]event_products['"]\)/);
});

test('helper never throws \u2014 wraps everything in try/catch and returns empty on error', () => {
  assert.match(HELPER, /try\s*\{[\s\S]*?\}\s*catch/);
  assert.match(HELPER, /return empty/);
});

// ---------------------------------------------------------------------------
// Client wiring
// ---------------------------------------------------------------------------

test('client sends eventId to trial-pass preview + checkin + reject calls', () => {
  // All three trial_pass fetch bodies now include eventId
  const trialPassFetchBlocks = CLIENT.match(/\/api\/capacity\/trial-pass\/scan[\s\S]*?body:\s*JSON\.stringify\([^)]+\)/g) || [];
  assert.ok(trialPassFetchBlocks.length >= 3, `expected at least 3 trial-pass fetch blocks, got ${trialPassFetchBlocks.length}`);
  for (const block of trialPassFetchBlocks) {
    assert.match(block, /eventId:\s*eventId\s*\|\|\s*undefined/, `trial-pass fetch missing eventId: ${block.slice(0, 200)}`);
  }
});

test('preview card renders linked-ticket pill for trial_pass too', () => {
  assert.match(
    CLIENT,
    /kind\s*===\s*['"]member_id['"]\s*\|\|\s*kind\s*===\s*['"]trial_pass['"]\)\s*&&\s*preview\?\.data\?\.linked_ticket/,
    'linked-ticket pill must render for both member_id and trial_pass',
  );
});

test('verify button label reflects combined action for trial_pass', () => {
  assert.match(
    CLIENT,
    /preview\.kind\s*===\s*['"]trial_pass['"]\s*&&\s*preview\.data\?\.linked_ticket\)\s*return\s+['"]Check In \+ Ticket['"]/,
  );
});

test('result card rolls ticket outcome into message for both member_id and trial_pass', () => {
  assert.match(
    CLIENT,
    /\(kind\s*===\s*['"]member_id['"]\s*\|\|\s*kind\s*===\s*['"]trial_pass['"]\)\s*&&\s*body\?\.ticket/,
  );
  // Both success and already_used branches must exist
  assert.match(CLIENT, /body\.ticket\.result\s*===\s*['"]valid['"]/);
  assert.match(CLIENT, /body\.ticket\.result\s*===\s*['"]already_used['"]/);
});
