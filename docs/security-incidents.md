# Security incidents and immediate bans

## Scope and architecture

Security Mode lives at `/capacity/security`, linked from the existing front desk. Each guard uses their own existing `front_desk` staff login. No shared identity, anonymous device-token access, new broad team permissions, native app changes, or permission grants are introduced. Front-desk accounts remain restricted to the front desk and this new page; team/admin users can also use it.

Member-account and Trial Pass QR credentials resolve server-side without admission writes. Revoked member credentials do not fall through to trial credentials; network errors are never treated as a missing account. Event tickets are deliberately rejected because they identify the buyer, not necessarily the person standing in front of the guard. Name-search fallback requires staff to confirm identity. No facial recognition is added.

Security lookup also accepts the native app's version-1 `{v:1,kind:"trial",code}` envelope. Current 43-character trial tokens resolve through `trial_passes.qr_token_hash`; legacy 12-character lowercase hex codes resolve through the unique `member_profiles.trial_pass_code`, restricted to trial-plan profiles. These are identity lookups, not admission eligibility checks. Unknown formats are not labeled as tickets. This compatibility fix requires no schema migration, permission change, or native app release.

The guard confirms identity, selects a category, records observed facts, and chooses Warning, Final warning, Manager review, or Immediate ban. Restriction confirmation names the guest. `record_security_incident` independently verifies the staff role and commits the incident, restriction, and existing restriction audit together. It derives actor name, timestamp, and active event/door session server-side. An actor-scoped request UUID makes retries idempotent and rejects changed payloads under the same UUID.

The existing restriction manager allowlist remains unchanged: Adam, Naish, and Jeyu can lift; other admins and front-desk staff cannot. Only the existing permission owner can change that list.

## Data and privacy

- `security_incidents`: private, append-only factual history with category, action, actor, timestamp, event, confirmed identity links, and optional restriction.
- `security_warning_reminders`: private, append-only record of exactly which warnings were reviewed, by whom, during which venue shift.
- Neither table has public/authenticated table access or customer-facing endpoints. Only service-role server code can invoke the mutation RPCs.
- Identity joins follow explicit account/pass/profile links in both directions. Names and contact details are not used to automatically attach incidents to another account. Existing manual-restriction advisory matching remains intact.
- No QR values are stored in incident history or logged by Security Mode. Profile photos use existing short-lived signed URLs.
- No deletion, silent editing, automatic expiry, or automatic strike-count bans are introduced. Corrections require a follow-up record; a future administrative correction/retention policy should preserve audit history.

## Front-desk behavior

The existing `AccessCheck` beside each profile shows warning notes, timestamps, staff attribution, and full incident history. A pending warning requires “Record reminder delivered” before admission is enabled. This does not lift or bypass a restriction.

A reminder lasts for the venue shift, using the existing America/Chicago 6am rollover. New warning IDs after that reminder require a new acknowledgment. Warnings recur at later shifts until a separately designed resolution/retention policy is approved; there is no implicit expiry.

The common server-side admission guard checks incidents and reminders as well as bans. This covers member ID, Trial Pass, ticket, guest-list, and named roster admission. A one-tap roster check-in encountering a warning/restriction opens the guest panel. Older clients that do not implement reminders receive a hold response instead of bypassing the check.

Active restrictions remain higher priority than reminders. A later warning never lifts a ban. Scanning or saving a warning never changes membership, consumes a ticket, activates a pass, increments capacity, or sends the guest a notification.

## Operational boundaries

- If the database/history check fails, admission is held rather than displaying “clear.”
- Existing front-desk status polls every 15 seconds; every admission attempt rechecks server-side.
- Incident + ban creation is atomic. The existing application-level admission check and legacy admission writes are still separate operations, so an admission already in flight across that boundary can finish concurrently with a newly issued ban. This change does not claim a global transactional lock across all legacy admission writers.
- Anonymous headcount controls cannot identify a person and are not identity-based admission checks.
- A person with no account/QR and no search match can still be added manually in the existing Banned / restricted drawer; this Security Mode does not create a fictitious account.
- A physical altercation should be handled first. No QR interaction is required before staff take immediate safety action; document and link the account when safe.
- Historical lookups fail closed if bounded identity/history limits are exceeded (1,000 incident rows or identity keys), rather than silently truncating warnings. Long-term pagination/retention can be added when operationally required.
- Camera operation on the actual guard phone, authenticated production roles, and a real guest scan remain deployment acceptance tests.

## Rollout and rollback

Production approval is required. This implementation does not apply migrations or merge itself.

1. Apply `20260929190000_security_incidents.sql`, then `20260929202000_security_incident_privileges.sql`, to the existing production Supabase project before code deployment. These create private tables/functions and explicitly remove default service-role update/delete/truncate grants. They change no guest records or staff permission grants.
2. Verify RLS, direct-access revocations, immutable triggers, and service-only RPC privileges.
3. Merge the reviewed PR and verify the existing Vercel deployment is READY at that commit.
4. Authenticate on a real staff phone. Scan a designated test account, verify photo identity, save a warning, and verify the front-desk reminder and admission guard.
5. With explicit permission, test a ban on that designated test account. Verify all applicable check-in routes refuse entry, then have an authorized manager lift it. Do not test bans on uninvolved guests.
6. Test offline/save failure, revoked QR, missing photo, manual search, same-name guests, and shift turnover.

Rollback code first if needed; retain the additive tables and history. Reverting code also removes the new warning gate, so communicate that operational change. Existing bans use the established restriction tables and remain enforced by pre-feature code. Do not delete incident or restriction records to roll back.
