# Owner View Portal

## Delivery status

The feature branch implements the owner selector and isolated-session mechanism, not a production role override. Launch remains disabled until the isolated environment passes acceptance. It depends on the additive-access changes in web PR #321.

The approved Supabase branch is `owner-view-portal`, project reference `ygcqwohfnijjaeoobwhj`, under the existing Stardust organization. It was created with `with_data=false` at the quoted rate of $0.01344/hour. Its historical migration replay originally failed after creating only `team_events` and `team_members`. On September 23, 2026, the isolated database was repaired from a metadata-only production snapshot: 95 tables, 1,147 columns, 504 constraints, 249 standalone indexes, 92 application functions, one view, 49 triggers, 251 public/storage policies, all explicit grants and five Realtime publication entries matched the source snapshot exactly. No production rows, Auth users or storage objects were copied.

Supabase's branch control-plane status still reports the original `MIGRATIONS_FAILED` event, while the preview project itself reports `ACTIVE_HEALTHY` and accepts Auth, SQL and PostgREST traffic. Treat the stale branch label as an infrastructure caveat; database parity is supported by the independent catalog comparison and acceptance tests rather than that label.

The Vercel CLI connection fails its certificate signature check, preventing deployment/configuration in this session. Do not disable TLS verification to work around it.

## Architecture

- Production control page: `/bananas/view-portal`. It requires the existing owner gate, the configured immutable auth user UUID, and an AAL2 session.
- Production launch API: `/api/admin/view-portal/launch`. Every request independently checks owner UUID, administrator role, mandatory MFA, exact Origin, fixed persona ID, and environment readiness.
- A signed 60-second handoff is POSTed to the separate sandbox hostname at `/view-preview/redeem`. Credentials never enter a query string.
- The sandbox consumes the nonce once, verifies the fixed persona's fixture registry, exchanges a generated magic link locally without sending email, and sets an ordinary Supabase session for that identity. The one-time generated link is never returned to the browser.
- Normal website routes, APIs and RLS run under the synthetic identity. There are no privilege overrides, fake roles, production-user selectors, or service-role clients in the browser.
- A signed, Secure, HttpOnly, host-only preview lease binds the identity to the owner-authorized persona for 30 minutes of website access. Every non-static sandbox request verifies both the lease and the authenticated subject.
- The global banner names the selected view and exposes Change View and Exit. Both submit a same-origin exit that clears the website lease and sandbox Auth cookies, including chunked cookies. Direct Supabase access tokens may remain valid until their normal Auth expiry, but can only access the isolated synthetic database.
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

1. Completed: restore and independently compare the full metadata-only schema. No production data or scheduler schema was copied.
2. Completed: replace all inherited Edge Functions with authenticated 403 stubs, remove database network privileges from browser and service roles, and confirm no cron schema exists.
3. Completed: apply the Front Desk, additive partner-access, View Portal registry and restricted-staff boundary migrations to the isolated database.
4. Completed: create 20 synthetic Auth users plus representative test events, tickets, allocations, bookings, contracts and staff data. Empty storage bucket configurations were recreated without copying files.
5. Completed: verify all 20 identities through real Supabase Auth and run 290 RLS/RPC boundary checks. A broad legacy `free_accounts_team_read` policy exposed the customer directory to Front Desk and Calendar Viewer; `20260923010000_restricted_staff_profile_boundary.sql` fixes it and the full matrix now passes.
6. Pending: obtain the isolated project server key securely and verify generated-link redemption, nonce replay denial and the authenticated subject/lease binding through the real Auth API.
7. Pending: deploy the reviewed application commit to a separate hostname with isolated config, no crons and no production secrets. The Vercel CLI connection currently fails certificate verification; do not bypass TLS.
8. Pending: run complete browser navigation for every persona, then set registry `ready=true` and enable launch. A database acceptance pass alone does not activate the View Portal.

## Acceptance matrix

Customer: free, active trial, expired trial, Weekender, Builder, Insider.

Partner: Artist/DJ, Promoter, Collective, Vendor, Event Organizer, pending invitation, disabled partner.

Staff: Team, Front Desk, Calendar Viewer, Admin without owner rights.

Combined: Member + Artist, Trial + Promoter, Team + Partner.

For every persona, test navigation and direct page/API URLs. Check both own records and another fixture user's records. The selector descriptions are expectations, not substitutes for server authorization.

## Limitations

- The branch contains synthetic identity and resource fixtures. Profile-photo uploads, contract file downloads, and fully populated empty-state variants still require browser/storage acceptance.
- Live session handoff, browser cookie isolation and full-page role behavior need the real isolated deployment to be tested end to end.
- Mandatory admin MFA in the general application may change how the synthetic Admin view behaves; configure and document that choice rather than silently treating it as tested.
- No one-click reset button is shipped yet. Re-seeding marks fixtures unready; transactional reset of associated sample records is a follow-up. Do not reset/rebase/merge this manually repaired Supabase branch: production's historical migration chain remains incomplete, and the repair was intentionally isolated.
- This is the website View Portal, not a native mobile device simulator.
- Repair deployment connectivity before any production merge or readiness enablement. The new restricted-staff policy migration is applied only in the sandbox, not production. Keep the selector disabled if any dependency is uncertain.

## Verification completed

- Focused suite: 16 API/authorization tests and 7 Node/database tests passed, including the restricted-staff policy regression and same-origin exit/cookie cleanup.
- Repaired branch: all 20 synthetic identities completed a real password login. The RLS/RPC matrix passed 290/290 checks, including own/cross-account tickets and profiles, restricted staff boundaries, partner assignment isolation, disabled partner behavior, owner denial and registry write denial.
- Safety: inherited Edge Functions now return 403, require JWT verification, and contain no outbound action. No cron schema, production Auth identities, production storage objects or production business rows were copied.
- Latest full regression suite: 61 API tests and 1,793 Node tests passed.
- Ten real Storage checks passed for own-photo upload/read/delete, cross-account denial, team visibility, and restricted Front Desk denial. Test image objects were removed afterward.
- Next.js production build passed; existing lint warnings remain.
- A separate interface-only representation was checked at 1,440px desktop and 375px phone widths. All 20 selection controls updated the chosen-view panel; keyboard selection, disabled launch, reload reset and horizontal-overflow checks passed without browser runtime errors.
- The standalone representation has no authentication or database connection. These checks do not establish full-site persona behavior, real cookie isolation or successful deployment.
