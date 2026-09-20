import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Guards for the hard-locked front_desk role introduced 2026-09-19. The role
// exists so every front-of-house staffer signs in as themselves at the venue
// laptop and every audit row (trial pass issued, guest checked in, capacity
// +1/-1) is attributed to a specific human — while access is locked to
// /capacity/front-desk and nothing else.

const migration = readFileSync(
  new URL('../supabase/migrations/20260919_front_desk_role.sql', import.meta.url),
  'utf8',
);
const authHelpers = readFileSync(
  new URL('../lib/auth-helpers.js', import.meta.url),
  'utf8',
);
const middleware = readFileSync(
  new URL('../middleware.js', import.meta.url),
  'utf8',
);
const loginPage = readFileSync(
  new URL('../app/login/page.js', import.meta.url),
  'utf8',
);
const invite = readFileSync(
  new URL('../app/api/admin/invite-team-member/route.js', import.meta.url),
  'utf8',
);
const teamUi = readFileSync(
  new URL('../app/bananas/team/TeamManagementClient.js', import.meta.url),
  'utf8',
);
const capacityOp = readFileSync(
  new URL('../app/api/capacity/operation/route.js', import.meta.url),
  'utf8',
);
const capacityUtils = readFileSync(
  new URL('../lib/capacity-utils.js', import.meta.url),
  'utf8',
);
const frontDeskPage = readFileSync(
  new URL('../app/capacity/front-desk/page.js', import.meta.url),
  'utf8',
);

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

test('migration adds front_desk to the valid_role check constraint', () => {
  assert.match(migration, /DROP CONSTRAINT IF EXISTS valid_role/);
  assert.match(
    migration,
    /valid_role[\s\S]+ARRAY\['admin'::text,\s*'team'::text,\s*'calendar_viewer'::text,\s*'front_desk'::text\]/,
  );
});

test('migration defines is_front_desk() as a SECURITY DEFINER helper', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.is_front_desk\(\)/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /role = 'front_desk'/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.is_front_desk\(\) TO authenticated/);
});

test('migration widens ONLY capacity_check_in and capacity_check_out', () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.capacity_check_in[\s\S]+public\.is_team\(\) OR public\.is_front_desk\(\)/,
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.capacity_check_out[\s\S]+public\.is_team\(\) OR public\.is_front_desk\(\)/,
  );
  // adjust / start / end / reset must NOT be re-issued here — they are
  // deliberately kept behind is_team()/is_admin().
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.capacity_adjust/);
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.capacity_reset/);
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.capacity_start_session/);
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.capacity_end_session/);
});

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

test('requireFrontDeskOrTeam admits admin, team, and front_desk only', () => {
  assert.match(authHelpers, /export async function requireFrontDeskOrTeam/);
  // The gate must accept exactly these three roles and refuse everything else
  // (including calendar_viewer and unauthenticated).
  const body = authHelpers.match(/export async function requireFrontDeskOrTeam[\s\S]+?^}/m)?.[0] || '';
  assert.match(body, /teamRole !== 'team'/);
  assert.match(body, /teamRole !== 'admin'/);
  assert.match(body, /teamRole !== 'front_desk'/);
  assert.doesNotMatch(body, /calendar_viewer/);
});

test('requireTeam still rejects calendar_viewer AND front_desk', () => {
  const body = authHelpers.match(/export async function requireTeam[\s\S]+?^}/m)?.[0] || '';
  // Explicit safety check: the two hard-locked roles must never sneak in
  // through requireTeam(), which gates every team-only write API route.
  assert.match(body, /teamRole !== 'team' && teamRole !== 'admin'/);
});

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

test('middleware pins front_desk to /capacity/front-desk and redirects everything else', () => {
  const branch = middleware.match(/const isFrontDesk[\s\S]+?return NextResponse\.redirect\(url\);\s+}/)?.[0] || '';
  assert.ok(branch.length > 0, 'middleware must have a front_desk branch');
  assert.match(branch, /teamRole === 'front_desk'/);
  assert.match(branch, /pathname === '\/capacity\/front-desk'/);
  assert.match(branch, /url\.pathname = '\/capacity\/front-desk'/);
});

test('middleware front_desk branch runs BEFORE the admin/team gates', () => {
  // Order matters: if the admin gate ran first, a front_desk visit to
  // /bananas would fall through and hit /bananas's own gate, which reads
  // fine but is the wrong shape. Ensure the front_desk branch is above
  // the isAdminRoute / isTeamRoute gates.
  const idxFrontDesk = middleware.indexOf('teamRole === \'front_desk\'');
  const idxAdminGate = middleware.indexOf('isAdminRoute && !isAdmin');
  const idxTeamGate = middleware.indexOf('isTeamRoute && !isAdmin');
  assert.ok(idxFrontDesk > 0 && idxAdminGate > 0 && idxTeamGate > 0);
  assert.ok(idxFrontDesk < idxAdminGate, 'front_desk branch must precede admin gate');
  assert.ok(idxFrontDesk < idxTeamGate, 'front_desk branch must precede team gate');
});

// ---------------------------------------------------------------------------
// Login redirect
// ---------------------------------------------------------------------------

test('login redirects front_desk straight to /capacity/front-desk, ignoring ?next', () => {
  assert.match(loginPage, /role === 'front_desk'/);
  // Destination must be a literal string, NOT `next || ...`, so a crafted
  // ?next=/bananas link cannot try to trick the gate (middleware would
  // still catch it, but defence in depth).
  assert.match(
    loginPage,
    /role === 'front_desk'\)\s*destination = '\/capacity\/front-desk'/,
  );
});

// ---------------------------------------------------------------------------
// Invite endpoint & Team Management UI
// ---------------------------------------------------------------------------

test('invite-team-member accepts the front_desk role', () => {
  assert.match(
    invite,
    /\['admin',\s*'team',\s*'calendar_viewer',\s*'front_desk'\]\.includes\(role\)/,
  );
});

test('Team Management UI exposes a Front Desk role tile', () => {
  assert.match(teamUi, /front_desk:\s*{/);
  assert.match(teamUi, /label: 'Front Desk'/);
});

// ---------------------------------------------------------------------------
// /api/capacity/operation gate wiring
// ---------------------------------------------------------------------------

test('capacity/operation dispatches check_in and check_out through requireFrontDeskOrTeam', () => {
  assert.match(capacityOp, /requireFrontDeskOrTeam/);
  // start / end / adjust must still hit requireAdmin, and reset still
  // requires team. The dispatch table is the source of truth for that
  // mapping — pinned by the CAPACITY_OPERATIONS test in capacity-utils.
  assert.match(capacityUtils, /check_in:\s*{[^}]*role: 'front_desk'/);
  assert.match(capacityUtils, /check_out:\s*{[^}]*role: 'front_desk'/);
});

// ---------------------------------------------------------------------------
// Front-desk page-level gate
// ---------------------------------------------------------------------------

test('/capacity/front-desk page gates on requireFrontDeskOrTeam', () => {
  assert.match(frontDeskPage, /requireFrontDeskOrTeam/);
  assert.doesNotMatch(frontDeskPage, /await requireTeam\(\)/);
});
