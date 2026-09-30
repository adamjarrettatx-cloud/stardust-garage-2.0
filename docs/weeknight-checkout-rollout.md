# Weeknight member checkout

The approved website offer is at least 20% off eligible weeknight ticket products for active Weekender, Builder and Insider memberships. This change implements that offer in the authoritative first-party checkout; it is not a change to membership subscription prices.

## Rules

- **Eligibility:** An authorized event editor explicitly enables “Eligible weeknight experience” in the existing Ticketing panel. No automatic classification by title, category or calendar weekday. Existing events default to false. New recurring drafts inherit the template flag.
- **Member standing:** Existing server rules require `is_active=true` and subscription status `active` or `trialing`. Only Weekender, Builder and Insider get the new benefit. Free accounts, inactive memberships, the `trial` plan and Trial SDG Passes do not automatically inherit it.
- **Percentage:** A flagged eligible event has a 20% minimum for paid tiers, including if a lower per-event override was stored. Higher applicable rates remain; Insider stays capped at 60%. Weekend and weeknight benefits never add together.
- **Products:** Membership discounts apply only to ticket products. Private-space rentals and booking fees are unchanged. Existing tax calculation is retained on the discounted taxable amount plus fees.
- **Promo codes:** The greater ordinary promo-code discount or member entitlement wins, never both. Existing exact-total (`target_total`) codes deliberately keep precedence and are not stacked with membership; that existing exception is unchanged.
- **Authoritative charging:** Event flags, membership and prices come from server records, never client-supplied percentages or plan names. Failed entitlement lookups block checkout rather than silently charging full price.
- **Stripe allocation:** Discounted line totals conserve every cent, retain product scope and split quantities when necessary. Inventory hold items are unchanged.
- **Display:** The website ticket preview excludes rentals from its member-discount base. Internal event labels on website and mobile resolve the same policy. Legacy external-provider behavior is unchanged; this does not configure Ticket Tailor discounts.

## Verification

Run `npm run test:weeknight`: 19 real-route tests with mocked network/payment boundaries plus 83 pure/regression/database tests passed. Route tests execute the actual preview and hold handlers and project their actual SELECT columns; they test 20% for each tier, membership status, forged request fields, lookup failures, mixed rentals, code precedence and exact Stripe/hold totals.

The integer-allocation test covers 10,000 combinations. The additive migration is exercised twice in PGlite to verify idempotence, default false, non-null enforcement and retained RLS policy. A further 13 event-series/legacy-discount regressions passed. Website production build passed with existing warnings.

The matching mobile branch has 67 passing tests, passing TypeScript and successful iOS/Android Hermes exports. Run `node scripts/check-weeknight-policy.cjs <website-checkout-path>` in mobile to compare 8,000 website/native discount combinations. Exports are not signed TestFlight builds, real-phone acceptance or live paid-transaction evidence.

## Production rollout

1. Obtain approval for this pricing/schema deployment. The earlier website PR 360 approval covered shared membership content, not this new pricing change.
2. Apply `supabase/migrations/20260930140000_weeknight_member_benefit.sql` to the verified production project `iwgfelvbebqbaotkylsw` before deploying code that selects the column. No event is opted in by this migration.
3. Merge the reviewed pricing branch and verify the production deployment, public membership endpoint, published internal event display and checkout authentication boundary.
4. An authorized editor opts approved weeknight programming in. Do not flag all existing events. The read-only September 30 inventory review found no upcoming Wellness/Movie title candidates; names alone would not be sufficient authorization anyway.
5. Test eligible and ineligible pricing with approved test identities/fixtures; do not create production orders, charges or public test events without authorization.
6. Ship the matching mobile source as a replacement TestFlight candidate after backend verification. Obtain acceptance of that exact build before public App Review.

## Rollback

Roll back the website deployment if needed, leaving the additive column in place. Do not drop the column while any deployed code selects it. Stop enabling new eligible events during an incident and clearly communicate any paused benefit; existing paid orders and in-flight holds must not be repriced retrospectively.
