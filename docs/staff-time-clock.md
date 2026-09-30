# Staff time clock

Integrated implementation for the approved SDG front-room iPad kiosk and timekeeping management view. Adam and Jeyu manage the roster themselves; there is no developer-mediated onboarding step. This feature is off by default and is not a payroll processor.

## Routes and access

- `/clock`: standalone shared-device kiosk. No owner links, public navbar, sound toggle, or marketing attribution. The response blocks framing and third-party scripts/connections.
- `/api/time-clock/[action]`: paired device plus short-lived worker session. No staff Supabase account is required and no general application permission is granted.
- `/bananas/timekeeping`: dedicated `timekeepingPageGate()` and sidebar visibility for Adam (`adam@sdgatx.com`) and Jeyu (`jeyu@sdgatx.com`), each also requiring verified `team_members.role = admin`.
- `/api/admin/time-clock`: dedicated `requireTimekeepingManager()` on every read/write, including CSV and PIN reset. Uses verified Auth email, not editable metadata. MFA follows the repository's existing `ENFORCE_ADMIN_MFA` policy through `requireAdminMfa()`. Global owner gates and access to financials, Artist Pay, settings, and View Portal remain unchanged.

## Implemented

- Backend **Timekeeping → Staff profiles**: Adam/Jeyu can create and edit names, employee/contractor labels, multiple role assignments, hourly rates per role or flat shift fees, and active/inactive status. Profiles do not require staff email addresses, Supabase logins, or developer input.
- Custom role names and responsibility templates; snapshots preserve old duties and rate values.
- Manager-chosen six-digit PIN or random generation when left blank, on creation and reset. Leading zeros preserved. One-time management display, HMAC lookup plus salted scrypt verification. No stored PIN recovery, plaintext persistence or logs. Duplicate PINs rejected atomically; reset invalidates old credentials and current worker sessions.
- One-time eight-digit device pairing, 15-minute pairing expiry, 90-day device credential, immediate owner revocation.
- HttpOnly, SameSite=Strict device/session cookies, Secure and `__Host-` names in production.
- Durable PostgreSQL attempt limits; PIN limit is device-scoped and survives wrong-PIN transactions. Pairing has global and per-forwarded-IP limits; production trusted-proxy/WAF settings still require operational verification.
- One open shift per worker, role segments, counted breaks, saved shift notes, responsibility completion, recent personal shift history.
- Server timestamped transaction and audit, same-request idempotent retry, stale shift-ID protection, role validation, request-body allowlists. Browser identity, time, rates and pay basis are ignored.
- 90-second idle expiry and a 15-minute maximum worker session; device/PIN revocation rechecked server-side. Activity-triggered touch only, never polling-based extension.
- Owner filtered reports, CSV, review notes, approvals, long-running-shift alerts, and audited start/end corrections in Austin time. Corrections reopen approval and preserve original punch events.
- UTC storage, America/Chicago display. Local correction conversion rejects nonexistent spring-forward times and explicitly disambiguates repeated fall-back hours.
- RLS on all timekeeping tables. Browser roles have no table or RPC grants; service-role direct writes are also revoked. Mutations occur through named server-only transactional RPCs.

## Scope and intentional limits

- Amounts are BASE ESTIMATES, not payable wages. No overtime, mixed-rate overtime, tip allocation, tax, withholding, deductions, regular-rate adjustment, salary allocation, or payroll-provider sync.
- Breaks are counted/paid time; there is no unattended deduction or auto-clock-out.
- Worker classification is an owner-provided operational label, not a legal determination.
- Review approval never sends money or creates an Artist Pay request.
- Role-rate edits apply to future segments; previous captured rates remain unchanged. Corrections do not alter rates.
- Reports select shifts by their start timestamp in a rolling 7/14/31/93-day window; they are not workweek-allocation reports. The range is capped at 500 shifts and requires narrowing if exceeded. Active-shift count includes all dates.
- Owner corrections adjust first/last role boundaries. They cannot trim through interior role changes/breaks. Segment-specific corrections, historical rate adjustments, and manually entering an entirely missed shift are not yet supported.
- This roster is independent of existing team/contact profiles. No automatic identity linking or application-access grants.
- No offline punches, biometric checks, GPS, worker surveillance scores, or task-based wage withholding.
- Online Chromium QA is not physical iPad Safari certification.
- Fresh device access should open `/clock` directly. Do not leave an owner login on the kiosk.
- Keep `TIME_CLOCK_SECRET` stable; rotating it invalidates device hashes, pairing codes, and PIN lookup/verifiers. Rotation requires reenrollment and PIN resets with a controlled migration.

## Reviewed rollout required

No production migration or enablement is performed by this branch.

### September 30 review fixes

The three database-review findings are fixed in this branch, not deployed:

- New profiles honor the requested active/inactive state.
- Deactivation rotates the worker credential version and removes their sessions. Reactivation needs a fresh PIN login; existing shifts remain intact.
- Audit sequence privileges are explicitly revoked, including inherited Supabase defaults. Privileged RPCs still create audit entries.

The database test bootstrap now reproduces production-like table/function/sequence defaults. The time-clock suite contains 64 passing tests (29 database, 29 API, 6 helpers). Native PostgreSQL tests additionally cover both lock orders when deactivation and a clock-in happen together.

`tests/time-clock/native-postgres-review.py` runs only against a disposable local database named `sdg_timeclock_hardened`, via the local Unix socket. Bootstrap a fresh database with `auth.users`, one synthetic actor with ID `11111111-1111-4111-8111-111111111111`, Supabase-style roles/default grants, and the reviewed migration. It never connects to production. The prior review's PostgreSQL 18.6 run does not replace hosted PostgreSQL 17 validation.

### Hosted test preparation

`scripts/time-clock-staging-smoke.mjs` is prepared for a separately approved, fresh Supabase staging environment. It has not been run on a hosted project yet. It rejects the known production ref, custom production hostname, missing explicit approval, and existing worker records.

Required server-side environment variables:

- `TC_STAGING_APPROVED=yes`
- `TC_STAGING_PROJECT_REF` and matching `TC_STAGING_URL=https://<ref>.supabase.co`
- `TC_STAGING_SERVICE_KEY` and `TC_STAGING_PUBLIC_KEY`, both belonging only to that isolated environment

Do not reuse production `.env` files or print the keys. Run `node scripts/time-clock-staging-smoke.mjs` after applying the corrected migration to the approved test target. It creates an email-confirmed synthetic Auth identity without sending an invite, fictional profiles, a kiosk, and test shifts, and retains them for inspection rather than deleting history. Expected checks include real PostgREST nested reports, RPCs, PIN verification, task/break/role changes, approval, deactivation/reactivation, access denials, and device revocation.

The runner does not certify Next.js manager sign-in, browser Origin/cookie/proxy behavior, CSV UI, or the physical iPad. A paid hosted branch still requires organization/cost approval before creation. Do not reuse the failed `owner-view-portal` branch.

1. Review the code and the additive migration `20260930031000_staff_time_clock.sql`.
2. Verify the intended Supabase project reference from the existing Vercel application's configuration. Do not select by similar project names.
3. Validate the migration in an isolated Supabase environment, including real PostgREST relationship embedding, RLS, service-role grants, and multi-connection concurrency. The local PGlite tests execute the real SQL but do not emulate PostgREST or separate database connection races.
4. Install a server-only random secret of at least 32 bytes, encoded as 43+ base64url characters, as `TIME_CLOCK_SECRET`. Do not expose it with a `NEXT_PUBLIC_` prefix or paste it into a ticket.
5. Apply the reviewed migration to the selected environment.
6. Set `TIME_CLOCK_ENABLED=true` in that environment and deploy the reviewed feature branch. Missing flag or secret fails closed. Do not enable a preview against production Supabase without explicit approval.
7. Adam or Jeyu opens Timekeeping → Staff profiles. Create and update real profiles, assigned roles, and rates in the backend, and privately provide chosen/generated PINs. No roster needs to be supplied to a developer. Verify both permitted admin accounts can access the page, and other admins cannot.
8. Adam or Jeyu creates a kiosk pairing code; enter it at `/clock` on the front-room iPad without leaving an admin session on the device. Verify iPad browser lockdown and loss/revocation procedures operationally.
9. Perform a real worker test: clock in, refresh, switch role, record responsibility, clock out, owner sees exact record, export, and revoke a test device. Do not treat branch merge as proof of successful operation.
10. Confirm pay model, fixed workweek, pay period, break policy and overtime treatment before extending base estimates into payroll.

## Validation

- `npm run test:time-clock`: real migration/state machine via PGlite plus API authorization/validation tests and crypto/pay/time helpers.
- `node --test tests/admin-tabs.test.mjs`: navigation regression suite.
- `npm run test:security`: existing restricted front-desk and security workflow regressions.
- `npx eslint --ext .js,.jsx,.mjs app/clock app/components/time-clock app/bananas/timekeeping lib/time-clock app/api/admin/time-clock 'app/api/time-clock/[action]'`.
- `npm run build`: production Next.js bundle and route compile.
- `npm run qa:time-clock`: localhost-only harness on 127.0.0.1:8090. Bundles the real React screens and API handlers with an isolated PGlite database. The Supabase transport and owner identity boundary are replaced only in this harness; it is not a production auth path.
  - Kiosk: `/clock`, pairing `12345678`, synthetic PIN `123456`.
  - Owner screen: `/owner`; automated QA injects a local test-only cookie `tc-qa-owner=local-test`. This cookie is read ONLY in the nonproduction harness and is meaningless to deployed app routes.
  - All data is synthetic/in-memory and resets on server restart. Generated output is ignored under `.time-clock-qa/`. No live credentials are required.

Observed browser QA: device pairing, PIN entry, clock-in, saved task/note, reload persistence, break start/end, role switch, incomplete-task clock-out, receipt, owner review, Austin correction and reapproval, CSV, 93-day filter, custom role creation, flat-fee worker creation, PIN reset, pairing-code creation, lost-response retry, offline lockout and kiosk-to-owner access denial.

Validation at initial implementation handoff (before staff-management access update):

- 23 database tests, 13 API tests, and 6 pure-helper/crypto tests passed (42 time-clock tests).
- 83 admin-navigation tests and 12 authenticated-theme tests passed (95 regression tests).
- Existing security suite passed: 30 API tests and 17 Node/database tests.
- Production Next.js build passed and the new routes compiled.
- Actual local Next.js production server returned `/clock` with `X-Frame-Options: DENY` and its restrictive CSP. With the feature disabled, the page showed setup pending and the state API returned 503.
- Integrated screens inspected at desktop 1440px, iPad landscape 1024×768, and mobile 375×812; no page-level horizontal overflow in the tested kiosk/owner states. Light and dark kiosk states checked.
- Browser idle lock was observed; revoking the paired device caused the kiosk to return to pairing. No browser page errors occurred in the tested integrated flow.
- The observed lost-response test committed a clock-in but dropped its HTTP response, then retried with the same request ID. Exactly one open shift existed afterward.

The feature remains subject to production rollout and real-device verification even when every local check passes.

## Staff-management update, September 30

- Self-service management for Adam and Jeyu, with no access expansion to other owner-only sections.
- Staff profiles renamed and documented; choose or generate six-digit PINs on create/reset. Same-PIN reset and duplicate PINs rejected. No extra production migration has been run; the original unapplied migration includes the same-PIN guard.
- 59 time-clock tests passed: 24 database, 29 API/access/PIN, 6 helper/crypto.
- 96 navigation/theme tests passed; existing security suite remained green (30 API and 17 Node/database).
- Browser checks against real UI/API and isolated SQL: create contractor with two role rates and leading-zero PIN; reload persisted values; edit name/classification to employee and flat fee; duplicate reset rejected; chosen replacement accepted by kiosk while old PIN rejected; deactivate/reactivate and verify kiosk denial; blank reset generated a replacement. No page errors.
- Desktop, tablet and mobile staff forms/reset states inspected. Corrected selected-role styling so assignment checkboxes are not struck through. Reset dialog traps focus and supports viewport scrolling.
- Sample-data preview now includes editable staff profiles. It remains a separate in-memory demonstration, not the production database.
