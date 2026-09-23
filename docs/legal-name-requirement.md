# Legal names and front-desk corrections

## Scope

Require at least a first and last name for Trial Pass intake, staff-issued Trial Passes, password account creation, OAuth profile completion, and membership applications. The existing single name field is retained, relabeled “Legal first and last name,” with the notice:

> Enter your legal first and last name as shown on your ID. If you do not provide your legal name, you may be denied entry.

Shared API validation also protects older/mobile clients posting `fullName`. The native app's screen copy is not changed by this web release. Newsletter-only subscriptions and business inquiries are not venue-access account creation and are unchanged.

Validation cannot prove legal identity. It does not blacklist “John Doe.” Staff compare the name against ID, and may deny entry using existing controls. International letters, accents, spaces, initials, hyphens, and apostrophes are supported.

## Staff workflow

“Edit legal name” appears in the Trial Pass roster details, scanner identity preview, guest-list check-in sheet, and the newly created manual pass result. Saving requires a first-and-last name, correction reason, and ID-check confirmation. Admission is disabled while the correction editor is open. The edit never admits the guest or changes a restriction, entitlement, pass dates, payment, ticket status, or waiver.

The API authenticates the current staff member using server-controlled roles. A private service-only SQL function independently rechecks that role, follows existing profile/user IDs, rejects conflicting linked accounts or stale displayed names, updates related profiles atomically, and writes an append-only staff audit record. Names, email addresses, and phone numbers never establish new profile links.

Previous names remain available to restriction matching as possible matches, not automatically confirmed identities. Name-history lookup failures fail closed. Historical orders are retained except for a legacy scanned ticket whose order is its only profile record; that targeted name correction is audited too. Provider/auth metadata and signed documents are not rewritten.

## Rollout

1. Apply `20260923010000_legal_name_corrections.sql` to the production database.
2. Merge and deploy the matching web changes.
3. Refresh front-desk browsers; verify a controlled staff correction and a new signup.

The migration adds intake triggers without rewriting or deleting existing customer records. Unrelated updates to legacy single-name rows still work. Editing an existing name must satisfy the new requirement.

The migration must precede deployment: access-restriction checks read correction history and intentionally fail closed if the new table is unavailable.

## QA inventory

- Intake: reject single, blank, numeric, invisible-character, and overlong input; accept international/compound names.
- API: anonymous/non-staff denied, server-derived actor only, ID check/reason required, unsupported IDs rejected, stale writes and database failures reported.
- SQL: linked-profile updates, audit attribution, rollback on audit failure, unlinked legacy ticket correction, used ticket unchanged, historical order preserved, legacy unrelated updates allowed, direct anonymous/authenticated access denied.
- Restrictions: old-name matches remain advisory holds after correction; missing history fails closed.
- OAuth/checkout: provider metadata alone does not complete an account; canonical stored name required before inventory/Stripe writes.
- UI: desktop and mobile intake, roster editor, save disabled until ID check/reason, admission disabled during edit, correction reflected immediately, cancel leaves name unchanged, manual creation result can be edited.
- Production: no live customer name changes, SMS, emails, payments, or check-ins performed during development.
