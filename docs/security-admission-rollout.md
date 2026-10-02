# Security and atomic admission rollout

Prepared October 1, 2026. Production has not been migrated or deployed; this change is not an App Store security certification.

## Changes

- Account profile RPCs cannot replace photo pointers. The photo read/delete endpoint independently checks ownership, and database triggers reject client-side pointer changes.
- One server-only transaction validates current staff/station/device access, pass validity, selected live door event, ticket and order status, and venue capacity.
- Admission, ticket consumption, capacity and scan history commit or roll back together.
- Canonical account/event identity prevents repeat member/trial scans from consuming additional group tickets. Existing same-event admissions are recognized.
- Group tickets are scanned first and paired with the attendee's own pass before entry. Ticket-only check-in and override requests fail closed.
- Comp guests also require an issued valid event ticket and their own pass. The old guest-list admission button is blocked; roster name-only admission is blocked during an active door event.
- Shared Front Desk station sessions are revalidated in the transaction, including revocation; no team membership is fabricated for station accounts.
- Post-admission notifications and trial application-invite email run after a successful commit. No duplicate admission schedules another notification.
- The legacy iPad scanner now uses the unified scanner, and the unified website scanner skips its old client-side capacity increment for transaction-managed admissions.

## Migration and deployment order

1. Owner approval for the production policy changes and migration.
2. Apply `20261002010000_account_photo_ownership.sql`.
3. Apply `20261002011000_atomic_door_admission.sql`.
4. Merge/deploy the reviewed website commit. Do not leave the old server deployed indefinitely after applying the migration.
5. Publish the matching mobile preview update, not the production channel or App Store release.
6. Verify the live deployment and preview update identifiers, then run owner-approved controlled admissions with test accounts/tickets.

Both an active door event and an active capacity session are now required for event entry. No membership exemption is implicitly allowed to skip a ticket; a free/comp admission must still have a valid ticket.

## Verification performed

The local PostgreSQL-compatible tests execute the actual migration function, including missing tickets, wrong events, refunds, inactive/unpaid memberships, missing photos, full capacity, repeated scans, group pairing, trial activation, revoked station access, anonymous RPC privileges and rollback after a deliberately induced late failure. These tests do not replace a two-device test against a staged or deployed PostgreSQL instance.

Additional HTTP boundary tests cover unauthorized callers, unavailable restriction checks, failed database calls, ticket-only override attempts, and poisoned account-photo pointers. The mobile scanner has staging/expiry/cancellation wiring tests; on-phone camera and pairing acceptance remain pending.

Production-build validation uncovered an existing invalid exported route constant (`TAB_META`); it is now local to its module without changing runtime behavior. Existing source-shape assertions were updated to follow the new transaction and post-commit notification boundaries rather than preserving the removed optional-ticket behavior.

## Release hold

Do not submit to Apple yet. Remaining gates include the exact mobile candidate on phone, controlled simultaneous scanner/retry testing, dependency advisory remediation or justified exposure disposition, broader privileged-function review, and browser handoff expiry hardening.

The current implementation deliberately fails closed if the admission RPC is absent, the event changes, ticket validation fails, or any transaction write fails. A build passing tests is not a claim that no exploitable vulnerability exists.

## Rollback

Do not revert to ticket-optional admission as a routine rollback. Keep the new functions/table in place and stop admissions with an explicit staff notice if a defect is found; prefer a forward fix.

The photo migration restricts general profile RPCs but keeps their signatures. Do not restore client-controlled photo paths. Admission history must not be deleted to make retries pass.
