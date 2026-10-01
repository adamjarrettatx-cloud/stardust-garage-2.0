# Membership discovery integration

## Scope

- `/members` becomes the approved mobile-first quiz, with account creation/sign-in required before beginning.
- Completed responses and server-computed recommendations save to `membership_quiz_results`, keyed by the authenticated user. The same account sees the saved result on another browser/device.
- The account profile shows the saved recommended membership(s) and a View my results link.
- Retaking the quiz does not replace a saved result until the new quiz is successfully completed.
- All current membership prices, application slugs, Stripe keys, entitlements, and approval requirements remain unchanged. Insider's included locker is added to shared offer content as directed.
- Gender is optional via Prefer not to say. It does not alter recommendation or price. No women-specific pricing is implemented.
- Application submissions require authentication, verified account ownership, account-scoped uploaded photos, 21+ DOB validation using Austin's local date, and idempotent submission keys.
- New applications link to the existing auth user on approval; legacy applications retain their existing approval path.

## Data and privacy

The new quiz table contains one latest completed response per account, optional self-identified gender, recommended application slugs, selected slug, and completion timestamp. RLS permits each user to read only their own row; writes use the authenticated server endpoint. Account deletion cascades quiz results. Admin application views receive a quiz snapshot only when an application is submitted. No quiz answers are placed in URLs, client storage, analytics events, or OAuth return parameters.

Completed quizzes, applications, and active paid members are different populations. Do not count quiz responses as active members; join `member_profiles` on `user_id` and use existing active-entitlement rules for any future member-demographic report.

## Release order

Requires approval for production schema and merge/deployment. Targets verified from existing rollout docs: Supabase `iwgfelvbebqbaotkylsw`; Vercel `stardust-garage-2-0`.

1. Review the PR and tests.
2. Coordinate migration `20261001030000_membership_quiz.sql` and code deployment. The migration removes anonymous/direct-client application inserts. The old application client cannot submit after this migration until the new code is live, so use a controlled low-traffic release window.
3. Deploy the exact reviewed commit through the repository's Vercel integration.
4. Verify logged-out quiz/apply entry shows account creation/sign-in, password and Google flows return correctly, and existing signed-in accounts proceed.
5. Complete a test quiz on a phone and open the same account on a computer. Confirm exact saved primary/secondary recommendations and account-profile link.
6. Confirm another account sees none of those results, retake replaces only the signed-in user's result, and application selection uses existing slugs.
7. With explicit permission for a test application, verify the authenticated photo upload, application submission, admin response display, and approval linking without changing prices.

## Validation commands

Local validation completed: production build succeeds; 8 Node/PGlite tests and 20 Vitest tests pass. Playwright checks cover mobile and desktop rendering, the 21+ gate, maximum three interests, failed-save retry, restoring a saved result in a separate browser context, synthetic-account isolation, light/dark themes, membership comparison and return, canonical application handoff, and preserving the prior saved result during an unfinished retake. The actual Next.js signed-out quiz and application pages also show the existing account gate without horizontal overflow at 375px.

The cross-browser UI checks use synthetic harness accounts. They do not establish that production OAuth or live Supabase persistence has been exercised. No production schema change, test application, or release was performed during local validation.

```sh
node --test tests/membership-quiz.test.mjs tests/membership-quiz-db.test.mjs
npx vitest run tests/api/membership-quiz.vitest.js tests/api/membership-application.vitest.js tests/api/account-profile-data.vitest.js tests/api/account-navigation.vitest.js
npm run build
node tests/membership-quiz/start-harness.mjs
```

The UI harness is isolated test infrastructure with synthetic accounts and an in-memory fixture store. It is not authentication, Supabase persistence, or evidence of production rollout. Real Google OAuth and cross-device production checks remain release acceptance steps.
