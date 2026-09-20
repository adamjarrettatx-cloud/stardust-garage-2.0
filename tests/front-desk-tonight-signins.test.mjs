import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Guardrails for the Tonight's Sign-Ins panel wired into the Front Desk.
// The panel powers the door attendant's chronological visual match: "did
// you sign in? what's your name?" -> find them on the list. This test
// enforces the two invariants that matter for that job:
//   1. The API route projects ONLY display-safe fields (no phone/email).
//   2. The client component renders the list oldest -> newest, matching how
//      a paper sign-in sheet reads.

const routeSrc = readFileSync(
  new URL('../app/api/team/trial-pass/today/route.js', import.meta.url),
  'utf8',
);
const clientSrc = readFileSync(
  new URL('../app/capacity/front-desk/TonightSignInsPanel.js', import.meta.url),
  'utf8',
);
const frontDeskSrc = readFileSync(
  new URL('../app/capacity/front-desk/FrontDeskClient.js', import.meta.url),
  'utf8',
);

test('today route is gated by a team-or-front-desk require*() helper', () => {
  assert.ok(
    /require(Team|FrontDeskOrTeam)\(\)/.test(routeSrc),
    'Route must call requireTeam() or requireFrontDeskOrTeam() before querying trial_passes',
  );
  assert.ok(
    /Unauthorized/.test(routeSrc),
    'Route must return 401 Unauthorized when the caller is not a team member',
  );
});

test('today route returns only display-safe fields', () => {
  // We explicitly WANT full_name and issued_at; we explicitly do NOT want
  // phone or email leaking into a door-facing surface.
  const selectMatch = routeSrc.match(/\.select\(\s*['"]([^'"]+)['"]/);
  assert.ok(selectMatch, 'Route must include an explicit .select() projection');
  const columns = selectMatch[1].split(',').map((c) => c.trim());
  assert.ok(columns.includes('full_name'), 'full_name is required for the door match');
  assert.ok(columns.includes('issued_at'), 'issued_at is required for chronological ordering');
  assert.ok(!columns.includes('phone'), 'phone must not be exposed to team-scoped door staff');
  assert.ok(!columns.includes('email'), 'email must not be exposed to team-scoped door staff');
});

test('today route orders sign-ins oldest first', () => {
  assert.ok(
    /ascending:\s*true/.test(routeSrc),
    'Signins must be ordered oldest -> newest so the earliest arrival stays at the top',
  );
});

test('today route bounds the window to a single evening', () => {
  assert.ok(
    /12 \* 60 \* 60 \* 1000/.test(routeSrc),
    'Rolling 12-hour window matches the /api/capacity/checkins fallback convention',
  );
  assert.ok(
    /\.gte\(['"]issued_at['"]/.test(routeSrc),
    'Query must filter by issued_at >= since',
  );
});

test('panel polls the today endpoint', () => {
  assert.ok(
    /\/api\/team\/trial-pass\/today/.test(clientSrc),
    'Panel must fetch from the team-gated today endpoint',
  );
  assert.ok(
    /setInterval/.test(clientSrc),
    'Panel must poll for live updates',
  );
});

test('panel is wired into the Front Desk left column', () => {
  assert.ok(
    /TonightSignInsPanel/.test(frontDeskSrc),
    'FrontDeskClient must render TonightSignInsPanel',
  );
  assert.ok(
    /import TonightSignInsPanel from '\.\/TonightSignInsPanel'/.test(frontDeskSrc),
    'FrontDeskClient must import the panel from its co-located module',
  );
});

test('roster check-in bumps venue capacity through the shared primitive', () => {
  // Row clicks call parent-supplied onCheckIn. Parent must route that
  // through bumpCapacityFor -- the same primitive the Guest List uses --
  // so the audit log shape stays identical to the tablet flow.
  assert.ok(
    /onCheckIn=\{[\s\S]*?bumpCapacityFor\(/.test(frontDeskSrc),
    'FrontDeskClient must wire onCheckIn -> bumpCapacityFor',
  );
  assert.ok(
    /trial-pass roster check-in/.test(frontDeskSrc),
    'Roster check-ins must be distinguishable in the capacity_events note',
  );
  assert.ok(
    /onCheckIn/.test(clientSrc) && /handleToggle/.test(clientSrc),
    'Panel must accept onCheckIn and expose a toggle handler',
  );
});

test('roster check-in survives a mid-shift refresh without double-bumping', () => {
  // The checked-in set is namespaced by Chicago calendar day so tomorrow's
  // shift starts clean, and persisted so a refresh does not re-arm the
  // checkboxes and bump the count a second time when reloaded.
  assert.ok(
    /localStorage/.test(clientSrc),
    'Checked-in state must be persisted so a refresh does not re-arm the checkboxes',
  );
  assert.ok(
    /America\/Chicago/.test(clientSrc),
    'Storage namespace must be scoped to the venue-local calendar day',
  );
  assert.ok(
    /sdg\.front-desk\.trial-roster-checked-in\./.test(clientSrc),
    'Storage key prefix must be stable and namespaced',
  );
});

test('roster row disables its checkbox after a successful check-in', () => {
  // Once a guest is admitted, the row must stop being interactive so a
  // second click cannot re-fire the capacity bump. The button carries
  // both `disabled` and `aria-pressed` for accessibility.
  assert.ok(
    /disabled=\{isIn \|\| isBusy\}/.test(clientSrc),
    'Checkbox must be disabled once the guest is checked in or while busy',
  );
  assert.ok(
    /aria-pressed=\{isIn\}/.test(clientSrc),
    'Checkbox must expose aria-pressed for screen readers',
  );
});
