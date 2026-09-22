# Front-desk access restrictions

Implemented within `/capacity/front-desk`; the existing three-column layout is unchanged.

## Staff workflow

- Open **Banned / restricted** in the header to search records or add a person manually. No pass or account is required.
- Specify banned, temporary restriction, or manager review. All active types hold entry. Temporary restrictions expire at an absolute instant, with dates displayed in America/Chicago.
- Add a specific reason and optional aliases, email, phone, identifying details, and staff instructions.
- Select a roster guest or open their guest-list/scan preview to see access status and notes. Use **Restrict / notes** to create a profile-linked restriction; append notes directly on a matched record.
- Exact server-resolved profile/account links are confirmed matches and block admission. Matching names, aliases, email, or phone without an established profile link are possible matches, not automatic bans.
- Staff must document identity verification to confirm a possible match or mark a different person. Confirming links the identity; different-person decisions suppress that restriction for that specific subject. Confirmed identity matches cannot be dismissed this way.
- Only explicitly authorized restriction managers can lift, with a required reason. As directed by the owner on September 22, 2026, the list is Adam Jarrett, Naish Kulpath, and Jeyu Bigelow. Only Adam can change this permission list in the drawer. Neither a generic `admin` nor `team` role grants lifting rights.
- Notes are append-only. Lifted/expired record history remains available beside matching profiles and through **Include lifted / expired**.

## Server enforcement

The trial-pass scan, member-ID verification, ticket check-in, guest-list admission, and new named trial-roster admission endpoint recheck restrictions before their admission writes. Client-side disablement is not the security boundary. Ticket override does not bypass restrictions. Failed lookups return a hold-entry response.

The roster keeps its existing capacity-only semantics and local shift-day checkmarks; it now performs the identity/access check server-side before incrementing capacity and only marks the checkbox after success. It does not activate the trial pass. Other pass/ticket rules remain in their existing QR scan routes.

Anonymous capacity counters are headcounts, not identity-based admissions, and cannot identify a banned person. Staff must use the named roster/scan/guest-list workflows. Matching is normalized exact name/alias/contact matching, not facial recognition or fuzzy identification. A guest using an unknown name and unrelated identifiers cannot be identified automatically.

Ticket checks use the existing buyer-present identity model because the ticket schema does not store an individual holder identity. Do not infer a restriction on unrelated attendees merely because somebody bought their ticket.

The application rechecks on every commit request but does not create a single database transaction spanning the lookup and every legacy admission mutation. A restriction created concurrently in the narrow interval after the check may require staff intervention. Capacity reconciliation and cross-device idempotency remain the pre-existing roster behavior and are not a new guarantee of this feature.

## Storage and permissions

Migration `20260922000000_access_restrictions.sql` adds five private tables plus one service-role-only mutation function. RLS is enabled and anonymous/authenticated direct access is revoked. The function independently checks the actor's current staff role and manager authorization, locks records for changes, and writes the state change and audit event in the same transaction.

No existing guest records are changed or backfilled. No real restricted-person records are seeded. No default manager grants are created.

## Rollout

1. Obtain approval to apply the migration, merge the feature PR, and deploy.
2. Apply the additive migration to the intended Supabase project before the application code becomes active.
3. Confirm table/RLS/function privileges and the migration receipt.
4. Merge and let the existing production Vercel project build.
5. Verify the actual production deployment is READY and inspect its deployed commit; a GitHub merge alone is not proof of deployment.
6. Smoke-test with authorized staff and manager accounts. Any test restrictions must use a clearly fictional test identity, never a real guest.

If the migration is missing, access checks deliberately fail closed. Do not deploy the code ahead of the migration. For rollback, revert the application commit while preserving private records and audit history; do not drop the tables or erase notes.

## Validation

- Node regression suite: 1,770 passing tests.
- Vitest route/API suite: 19 passing tests.
- Real PostgreSQL-compatible isolated PGlite test exercises migration, create/note/lift, grant/revoke, append-only audit, RLS grants, and confirmed-identity dismissal protection.
- Browser fixture uses the actual React components with fictional API responses. Desktop and mobile checks cover manual entries, notes, name-only verification, confirmed blocking, lifting/history, re-restriction, and scanner holds.
- The fixture replaces camera input with a simulated QR event. Real camera hardware, authenticated production sessions, and production database migration have not been exercised by that fixture.
- Existing live newest-first roster order is preserved. Its obsolete oldest-first test assertion was corrected; production ordering was not changed.
