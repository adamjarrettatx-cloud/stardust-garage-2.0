# Owner View Portal

## Delivery status

The feature branch implements the owner selector and isolated-session mechanism, not a production role override. Launch remains disabled until the isolated environment passes acceptance. It depends on the additive-access changes in web PR #321.

The approved Supabase branch is `owner-view-portal`, project reference `ygcqwohfnijjaeoobwhj`, under the existing Stardust organization. It was created with `with_data=false` at the quoted rate of $0.01344/hour. The branch reached `MIGRATIONS_FAILED`: it has only `team_events` and `team_members` in public after the first four historical migrations. Migration `20260605155935` references missing `events` and `member_profiles` tables. A complete, verified schema-only baseline is required before this branch can represent the website. Do not create guessed minimal tables or mark the branch ready.

The Vercel CLI connection fails its certificate signature check, preventing deployment/configuration in this session. Do not disable TLS verification to work around it.

## Architecture

- Production control page: `/bananas/view-portal`. It requires the existing owner gate, the configured immutable auth user UUID, and an AAL2 session.
- Production launch API: `/api/admin/view-portal/launch`. Every request independently checks owner UUID, administrator role, mandatory MFA, exact Origin, fixed persona ID, and environment readiness.
- A signed 60-second handoff is POSTed to the separate sandbox hostname at `/view-preview/redeem`. Credentials never enter a query string.
- The sandbox consumes the nonce once, verifies the fixed persona's fixture registry, exchanges a generated magic link locally without sending email, and sets an ordinary Supabase session for that identity. The one-time generated link is never returned to the browser.
- Normal website routes, APIs and RLS run under the synthetic identity. There are no privilege overrides, fake roles, production-user selectors, or service-role clients in the browser.
- A signed, Secure, HttpOnly, host-only preview lease binds the identity to the owner-authorized persona for 30 minutes of website access. Every non-static sandbox request verifies both the lease and the authenticated subject.
- The global banner names the selected view and exposes Change View and Exit. Exit clears the website lease; direct Supabase access tokens may remain valid until their normal Auth expiry, but can only access the isolated synthetic database.
- One preview identity is active per browser profile on the sandbox hostname. Opening a different persona affects other tabs on that sandbox; it never changes the production owner login. Use separate browser profiles for side-by-side identity comparisons.

## Config

Both deployments require:

| Variable | Purpose |
|---|---|
| `VIEW_PORTAL_MODE` | `launcher` on the control site, `sandbox` on the isolated site |
| `VIEW_PORTAL_OWNER_USER_ID` | Verified existing owner's immutable auth UUID, not an editable metadata field |
| `VIEW_PORTAL_SIGNING_SECRET` | Random 32-byte or stronger shared signing secret, server-only |
| `VIEW_PORTAL_CONTROLLER_ORIGIN` | Exact HTTPS origin of the owner control website |
| `VIEW_PORTAL_SANDBOX_ORIGIN` | Dedicated HTTPS hostname, never sdgatx.com and never the control hostname |
| `VIEW_PORTAL_READY` | Keep false until the release acceptance checklist passes |

Sandbox additionally requires `NEXT_PUBLIC_SUPABASE_URL=https://ygcqwohfnijjaeoobwhj.supabase.co`, that branch's own public and service keys, `NEXT_PUBLIC_SITE_URL` matching its hostname, and `VIEW_PORTAL_ISOLATION_VERIFIED=true` only after an isolation review. Never copy production environment variables wholesale.

The sandbox has no payment, payout, email, SMS, signing, Ticket Tailor, or push credentials. Node fetch is restricted to the exact sandbox Supabase host and refuses redirects and Edge Function calls. Browser CSP restricts connections and forms and removes third-party tracking. Middleware-generated external redirects are blocked except the explicit exit to the owner portal. Middleware cannot inspect downstream route-handler redirects, and CSP does not prevent top-level link navigation; audit every external navigation destination before activation. Hosting-level outbound restrictions and checking database-trigger/cron/function behavior remain required defense in depth; the fetch guard is not an operating-system network firewall.

## Setup order

1. Repair the historical baseline or restore a verified schema-only export into the isolated branch. Copy no production rows, auth users, files, vault secrets, scheduler jobs or integration credentials. Check all RLS, grants, functions, constraints, triggers and storage policies against the intended release.
2. Disable database network triggers, scheduled jobs, webhooks and copied Edge Functions in the sandbox. Use synthetic files only. Verify no live integration destination can execute.
3. Apply the additive partner-access migration to this isolated schema.
4. Apply `supabase/preview/view_portal.sql` to the sandbox only. This is intentionally outside the production migrations directory.
5. Set sandbox seeding credentials and `VIEW_PORTAL_SCHEMA_VERIFIED=true`; run `node scripts/seed-view-personas.mjs`. It creates the fixed synthetic identity set without email and leaves every registry entry `ready=false`.
6. Add representative synthetic events, tickets, allocations, bookings, contracts and photos. The identity seed does not yet create these resource fixtures. Validate each persona against its real backend, including denied direct URLs and cross-user records. Only then mark the corresponding registry entry ready.
7. Deploy the same reviewed application commit to the separate hostname with isolated config, no crons and no production secrets. Configure the owner UUID, signing secret and mandatory MFA on the controller.
8. Verify browser launch, host-only cookies, expiry, replay denial, subject mismatch, revoked partner behavior, external-call rejection and exit. Enable launch only after this passes. A GitHub branch or selector design preview is not an activated View Portal.

## Acceptance matrix

Customer: free, active trial, expired trial, Weekender, Builder, Insider.

Partner: Artist/DJ, Promoter, Collective, Vendor, Event Organizer, pending invitation, disabled partner.

Staff: Team, Front Desk, Calendar Viewer, Admin without owner rights.

Combined: Member + Artist, Trial + Promoter, Team + Partner.

For every persona, test navigation and direct page/API URLs. Check both own records and another fixture user's records. The selector descriptions are expectations, not substitutes for server authorization.

## Limitations

- Fixture creation has not run against a complete branch schema yet.
- Live session handoff, browser cookie isolation and full-page role behavior need the real isolated deployment to be tested end to end.
- Mandatory admin MFA in the general application may change how the synthetic Admin view behaves; configure and document that choice rather than silently treating it as tested.
- No one-click reset button is shipped yet. Re-seeding marks fixtures unready; transactional reset of associated sample records is a follow-up.
- This is the website View Portal, not a native mobile device simulator.
- Repair/reconnect infrastructure before any production merge or readiness enablement. Keep the selector disabled if any dependency is uncertain.

## Verification completed

- Focused suite: 15 API/authorization tests and 6 Node/database tests passed.
- Regression suite: 45 pre-existing API tests and 1,792 Node tests passed. The 15 portal API tests also passed separately and are now included in the default test command.
- Next.js production build passed; existing lint warnings remain.
- A separate interface-only representation was checked at 1,440px desktop and 375px phone widths. All 20 selection controls updated the chosen-view panel; keyboard selection, disabled launch, reload reset and horizontal-overflow checks passed without browser runtime errors.
- The standalone representation has no authentication or database connection. These checks do not establish full-site persona behavior, real cookie isolation or successful deployment.
