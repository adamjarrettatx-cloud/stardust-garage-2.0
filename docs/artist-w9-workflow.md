# Artist W-9 onboarding

## Approved operating rule

Create the artist in Contacts with an email address. The existing partner invitation flow sends the artist a one-time link to finish their name/photo profile. The completed profile exposes **Fill out w9**. Submission generates a signed, flattened standard IRS W-9, retains the original IRS instructions, and appends an authenticated electronic-signing receipt.

Only Adam, Jeyu, or Naish may review the signed document and approve or deny it. Any one reviewer is sufficient. Denial requires a comment and a new signed submission; previous submissions are retained unchanged. Approval unlocks artist booking, event attachment, and the existing eligible Request Pay flow. W-9 approval never approves a payment or enables Mercury execution.

## Access and retention

- Reviewers are seeded from the existing administrator identities for `adam@sdgatx.com`, `jeyu@sdgatx.com`, and `naish@sdgatx.com`. Access also requires that their administrator role remains active.
- The artist may access their own submissions through the authenticated profile. Staff receive booking readiness only.
- The full TIN, address, legal name, and signature exist in the private PDF, not separate tax-field database columns or notification content.
- Database metadata, audit history, notifications, and reviewer comments contain no intentionally captured TIN. Reviewer comments reject recognizable SSN/EIN patterns.
- Authenticated clients cannot download tax objects directly from storage. App downloads are authorized and audited through server routes.
- Signed submissions and their linked document/version records cannot be overwritten or deleted through the application. Rejected forms remain part of the history.
- Existing manually uploaded tax documents are not automatically approved. The old tax-profile PATCH shortcut is disabled.
- Invitation delivery failures leave the contact saved and show a retry notice. Administrators resend from Manage portal access rather than creating a duplicate contact.

## Form implementation

The bundled source is [IRS Form W-9, March 2024](https://www.irs.gov/pub/irs-pdf/fw9.pdf). The artist sees the complete certification, the applicable backup-withholding exception, electronic-signature consent, and a typed-signature field immediately before submission. Submission time, authenticated account ID, and submission ID are recorded. A SHA-256 digest binds the database record to the stored PDF.

Required fields are validated on both client and server, with conditional LLC/other classifications. The workflow requires a complete nine-digit TIN and supports U.S.-person W-9 submissions only. Foreign-person documentation and applied-for TINs require separate handling. Format validation and staff review are not IRS TIN matching. Text that cannot fit legibly or render accurately is rejected rather than silently altered.

## Rollout

1. Apply `20260924100000_artist_w9_approval.sql`. The database switch initially remains off.
2. Deploy the corresponding application commit.
3. Verify the three reviewer identities, private document bucket, restrictive policies, migration version, deployed routes, and unauthorized responses.
4. Enable through the service-role database operation `update public.w9_settings set enabled=true where singleton=true`.
5. Complete a real artist onboarding with the artist supplying their own information and an authorized reviewer making the actual review decision. Do not put synthetic tax forms in production.

The feature switch is a staged-rollout control, not an emergency security bypass: turning it off also disables the new booking/pay enforcement. During an incident after activation, keep the database protections and switch enabled; disable or revert the affected UI/endpoint instead. Never drop signed-submission tables or restrictive policies as a rollback.

## Verification

Run `npx vitest run tests/w9`, `npm test`, `npm run lint`, and `npm run build`. The W-9 suite exercises actual PostgreSQL functions and policies with PGlite, form/PDF validation, authorization, retries, immutable retention, reviewer limits, and booking/pay gates.

The isolated browser harness in `tests/w9/browser` imports the real React components and intercepts API calls. It does not use production authentication or send email. Run `node tests/w9/browser/qa.mjs` where Playwright is available. The QA inventory documents scope and intentional exclusions.

## Outside this change

SignNow contract execution, Mercury connectivity, payment release, foreign tax forms, IRS identity/TIN matching, and automatic renewal/replacement of an already approved W-9 are not changed. A changed legal identity or TIN after approval needs a separately designed replacement/re-approval flow; current approval is not silently overwritten.
