# Shared station accounts

## Release status

Candidate implementation for owner approval. No production migration, accounts, password creation, or deployment is performed by the implementation itself.

The owner chose shared station credentials. Audit actors identify the station, not the individual operating it. Rotate credentials when anyone who knows a password loses authorization, and sign stations out at shift end.

## Interfaces

- `/staff/login`: username/password station sign-in; no staff email field.
- `/bananas/team`: owner-managed shared station section with create, generated password, rotate password, disable/enable, and sign out all devices.
- Security lands on `/capacity/security`.
- Front Desk lands on `/capacity/front-desk`.
- Existing personal/email accounts remain unchanged. Successful station login removes personal Supabase cookies on that browser so station logout does not reveal a previous owner's session.

Creation and reset generate 192-bit random passwords on the server. They are shown once to the owner, never stored as plaintext by the application, and are final shared credentials rather than temporary passwords. Staff cannot self-reset or change roles. A failed password reset leaves access locked; owner retry is allowed after five minutes. Rotation preserves a previously disabled account's disabled status.

## Authentication architecture

Supabase Auth remains the password verifier. Each station uses a random internal `.invalid` email identifier, with no usable mailbox, and a protected `station_account` app-metadata marker. The identifier is never a user-facing login field. Stations deliberately have no `team_members` row, and database triggers prohibit cross-membership.

Provider access and refresh tokens are never sent to the browser or stored in station-session rows. The server revokes the provider refresh session immediately after password verification. The provider's residual access token is discarded, not used for authorization.

The browser receives a 256-bit random `__Host-sdg-station` cookie: Secure, HttpOnly, SameSite=Strict, Path=/, no Domain. Only its SHA-256 hash is stored. Each session is checked against current database state, active status, generation number, revocation, and a fixed 12-hour expiry. There is no idle timeout: periodic operational polling must not be mistaken for a human being present.

Supabase documents why JWT sign-out alone is not immediate access-token revocation: https://supabase.com/docs/guides/auth/sessions. This implementation instead validates its opaque station session server-side on each protected request.

### Authorization

`lib/station-policy.js` is an exact path-and-method allowlist. Middleware evaluates station cookies before legacy personal-login and device-token paths. Server authentication helpers also validate the station independently; invalid station cookies never fall back to another identity. No station can become an admin/team/partner simply by editing a username, metadata, cookie, or request body.

Security can identify guests, read relevant incident information, and record warnings or immediate restrictions. Its search endpoint returns only IDs, kinds, and names, up to 30 results. It cannot admit guests, operate the counter, redeem tickets, lift restrictions, or manage staff.

Front Desk can operate existing admission, guest-list, pass, ticket scanning, counter, roster, legal-name correction, and warning-acknowledgment workflows. It cannot record Security incidents, create restrictions, lift restrictions, manage permissions, or access unrelated administrative surfaces.

Station capacity operations use a service-only SQL function that resolves the session hash itself. It never accepts a client-selected actor and allows only check-in/check-out. Existing personal role predicates and RLS are not broadened. Existing service-only admission and incident functions recheck active station identity for the specific operation.

### Defenses

- Owner identity plus verified MFA is mandatory for all station management, independent of the existing optional `ENFORCE_ADMIN_MFA` flag.
- Browser mutations, including login/logout and owner controls, require exact Origin matching.
- Shared, atomic PostgreSQL login counters: 200 total attempts/15 minutes, 60 per reported IP/15 minutes, and 10 per username/15 minutes. Global and username enforcement do not rely on the client IP being trustworthy. Global first prevents unlimited creation of new bucket rows after throttling.
- Rate-limit/database/provider failures deny login. Unknown, disabled, and incorrect-password outcomes use the same response.
- Sign-out, rotation, disable, and all-device revocation invalidate database sessions; reenabling does not revive old cookies.
- Private session/account/limiter tables deny anonymous and authenticated SQL access. Access-event history is append-only and service-role TRUNCATE/UPDATE/DELETE privileges are revoked.
- No service credentials, Auth JWTs, password hashes, internal aliases, or session hashes are returned by station UI endpoints.
- Privileged pages and API responses are no-store. Existing incident and check-in records use the station's Auth user ID; guest-list audit details also include the station label and username.

These controls reduce risk; they are not a claim of invulnerability. Shared credentials cannot prove which person performed an action. Protect devices physically, use owner MFA and a password manager, rotate on operator changes, and monitor abuse/lockouts.

## Verification and deployment

Run `npm run test:stations`, `npm test`, `npm run build`, and `npm audit`.

The station tests cover username normalization, path/method allowlists, cross-origin denial, no personal-session fallback, owner MFA, strong generated credentials, provider token non-disclosure, rate-limit failures, creation rollback, password-reset failure locking, SQL role isolation, admission/incident permissions, old-generation replay, expiry, logout, enable-after-disable, immutable audit, service-role execution, and direct SQL privilege denial.

The local SQL integration test executes the real station migration in PGlite together with existing restriction, incident, and arrival migrations; a minimal legal-name function fixture exercises that migration's role extension. Production function-definition drift checks intentionally abort instead of guessing.

Before release:

1. Obtain owner approval for the exact UI and production migration/merge.
2. Confirm target Supabase project `iwgfelvbebqbaotkylsw` and Vercel project `stardust-garage-2-0`.
3. Confirm current SQL function definitions match migration guards. Apply `20260930190000_shared_station_accounts.sql` as one transaction before deploying code.
4. Merge the reviewed candidate and verify the production deployment is Ready.
5. Owner opens Team Members, completes MFA, and creates `security` and `front-desk`. Save each generated password privately; do not paste it into a chat or PR.
6. In separate clean browsers, verify actual password sign-in, workspace access, forbidden API/page access, guest lookup, and designated test-account door/incident workflows. Do not create a real guest ban just to test.
7. Verify disable, reenable, logout, password rotation, and all-device revocation against already-open browsers. A revoked request must fail even before the UI's 30-second session check redirects.
8. Verify guest-list, member pass, Trial Pass, ticket QR, roster, warning acknowledgment, capacity, and audit attribution on the actual door/security devices.

The production read-only preflight found the legacy `20260919_front_desk_role.sql` migration absent (role constraint lacked `front_desk`; helper absent), despite that code being merged. This new station implementation does not require it because station identities do not enter `team_members`. Do not silently apply that older migration as part of this release; existing personal Front Desk provisioning remains a separately tracked database mismatch.

The candidate also updates Sharp to 0.35.5 and compatible transitive fixes for npm advisories. Native QR/image tests and the full regression suite must pass after dependency changes.

### Rollback

Disable station accounts first, invalidating their sessions. Roll back the web deployment if needed. Keep the additive station tables and audit history; do not delete identities that appear in guest/incident records. Existing personal logins remain available. Do not roll back by dropping history or creating broad RLS exceptions.

## UI QA inventory

- Station login, incorrect credentials, loading state, success role destination, and personal-login exit.
- Owner controls opened with MFA, station list, create, duplicate username, generated-password display/hide, role selection.
- Rotate, revoke, disable/enable confirmation and cancel paths; changed status visible.
- Desktop and 375px mobile layout with no horizontal overflow; legible labels and error messages.
- Shared-account label and sign-out controls on existing operational screens.
- Real production-provider/device acceptance remains distinct from local mocked UI and database tests.

## Candidate verification results

- `npm test`: passed on the final candidate rebased onto the time-clock release, including 1,929 Node tests plus the configured Vitest/pretest suites.
- `npm run test:time-clock`: passed after integration. The legacy Incoming-navigation test now includes the newly merged owner Timekeeping tab; station permissions still deny time-clock endpoints.
- `npm run test:stations`: 15 API/middleware tests and 5 Node/SQL tests passed.
- `npm run build`: passed after dependency updates; existing unrelated lint warnings remain.
- `npm audit`: zero reported vulnerabilities after updates.
- Playwright preview QA: desktop 1365px and mobile 375px; both station destinations, invalid login, owner creation, duplicate username, password display/hide, disable/cancel/enable, rotate, revoke, refresh, and personal-login exit passed. No page JavaScript errors or horizontal overflow.
- Production read-only preflight: all five function-definition replacement guards match. No migration has been applied and no production accounts have been created.
- Preview uses the real React login/owner components with a demo-only fetch adapter. It is not evidence of a production Supabase password exchange or real-device acceptance.
