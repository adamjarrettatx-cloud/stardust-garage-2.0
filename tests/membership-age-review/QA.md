# Membership age-review QA

## Scope

- Exact approved notice for ages 21 and 22, directly below the quiz age field.
- Same notice when an application DOB indicates age 21 or 22.
- No notice for 23+; existing under-21 application restriction preserved.
- Reviewer list badge and detail warning derived on the server from stored DOB.
- Submission-date age keeps a flag stable when an applicant has a birthday before review.
- Existing authorized-team approval permissions and actions unchanged.
- No migration, automatic approval, legal-page edit, mobile release, or door-access change.

## Automated checks

Run from the repository root:

```sh
node --test tests/membership-age-review.test.mjs tests/membership-quiz.test.mjs tests/membership-quiz-db.test.mjs
npx vitest run tests/api/membership-application.vitest.js tests/api/membership-quiz.vitest.js tests/api/membership-welcome.vitest.js
node tests/membership-age-review/build-preview.mjs
```

## Browser coverage

The isolated preview renders production components with synthetic records and mocked quiz responses. All application and approval writes are disabled.

- Type 21 and 22: verify exact notice and “Continue to application.”
- Change to 23 or clear input: notice disappears.
- Enter 20: existing eligibility block; use Change my age to recover.
- Enter blank or fractional age: validation, no screening notice.
- Complete the 21-year-old quiz through a recommendation and application handoff.
- Change application DOB between 21, 22 and 23: notice updates accordingly.
- Team list: 21/22 flagged, 23 not flagged; status tabs and empty state still work.
- Team detail: warning above the unchanged approval area.
- Inspect desktop and 375px views in light and dark themes for text contrast, clipping and horizontal overflow.

Real authenticated production applications, approvals, notifications and door scans are intentionally not exercised by this preview.
