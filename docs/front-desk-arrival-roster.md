# Front desk arrival roster

## Operator behavior

- The manual issue form has a high-contrast **Full legal name** label and placeholder.
- With no search, **Sign-ins & guest search** shows one newest-first stream of Trial Pass signups and named roster check-ins during the current Chicago shift.
- A shift begins at 6 AM America/Chicago, including across daylight-saving changes.
- Searching finds saved Trial Pass, member and guest profiles regardless of when they signed up. Search is read-only and never moves a row.
- Names and signed profile photos appear beside the check-in action. Explicitly linked identities collapse into one person; identical names alone do not.
- A successful roster check-in returns to tonight’s list. Its database timestamp determines its position. Each later signup or check-in appears above it.
- Existing rows move when checked in rather than producing duplicate rows. Duplicate requests keep the original check-in time and do not increase capacity.
- Other staff devices and reloads use the same database-backed state. Polling refreshes every 15 seconds, on focus and after local issuance/admission/name correction.

## Admission boundaries

This is a named arrival/capacity operation, preserving the previous roster's separation from QR activation and ticket redemption. It does not activate a Trial Pass, send application invitations, redeem tickets, alter membership or grant a new entitlement. The profile photo remains visible beside a one-tap check. Tapping the check commits the arrival immediately; tapping the name opens details for name correction. Event eligibility (the Weekend Music Experience flag) governs QR activation and ticket pricing only and does not block a roster check-in. A missing selfie also does not block a roster check-in; the photo gate applies only to QR activation.

The server re-reads credential eligibility, resolves explicitly linked identities, and checks access restrictions for each linked subject before writing. Expired Trial Passes, inactive memberships, unlinked guest-only records and verification failures are not silently admitted. Guest-only records remain discoverable and direct staff to the established guest-list/ticket admission flow.

Search covers visitor identity tables, not arbitrary business contacts or unlinked accounts that have never acquired a visitor record. QR scan history and guest-list redemption remain in their existing Door activity surface; this roster records the signup and roster-check-in sequence.

## Database and rollout

Apply `supabase/migrations/20260924170000_front_desk_arrivals.sql` before deploying the application change. It adds:

- `front_desk_arrivals`: an RLS-protected, server-only arrival ledger, with actor and database timestamps.
- `front_desk_roster_check_in`: a service-role-only RPC. It validates the actor's role, locks the existing active capacity row, deduplicates linked identities within the shift, writes arrival and capacity audit rows, and increments capacity in one transaction.

No existing tables are altered and no customer data is backfilled. Historic browser-only roster checkmarks cannot be recovered as reliable shared records; schedule the cutover outside an active shift. A missing migration intentionally produces a visible hold-entry error instead of falling back to unaudited local checkmarks.

Rollback: revert the application commit. Leave the additive ledger and function in place to preserve the audit record. Do not delete arrival history.

## Verification

`npm run test:arrival-roster` covers timestamp ordering, historical search, explicit-link deduplication, privacy projections, authorization, expired/missing credential handling, DB atomicity, idempotency, capacity-limit rollback, actor attribution, role permissions, and Chicago midnight/DST boundaries.

Production smoke test requires an authorized staff account. Check a real returning guest only during an actual admission; do not create fake live arrivals or change capacity to test.
