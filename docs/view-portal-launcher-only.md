# Owner View Portal launcher-only release

This branch is based on current main, independently of the broader profile and
partner-access PRs. It adds the owner selector at `/bananas/view-portal`, a
same-origin POST launch API, and an owner-only Site Settings link.

It does not change existing middleware, general authentication behavior, database
schemas or policies, scheduled jobs, payment integrations, or public navigation.
The test sandbox remains a separate deployment and database.

The gate requires the existing owner page check, an immutable owner Auth UUID,
admin role, and an AAL2 session. Launch requires explicit readiness, a shared
server-only signing secret, different HTTPS controller and sandbox origins, and
a persona from the fixed synthetic catalog. Tokens expire after 60 seconds;
the sandbox consumes them once before establishing an isolated session.

Deploy disabled first. Required controller environment variables:

- `VIEW_PORTAL_MODE=launcher`
- `VIEW_PORTAL_OWNER_USER_ID`: verified existing owner UUID
- `VIEW_PORTAL_CONTROLLER_ORIGIN`: canonical live website HTTPS origin
- `VIEW_PORTAL_SANDBOX_ORIGIN=https://sdg-view-portal.vercel.app`
- `VIEW_PORTAL_SIGNING_SECRET`: 32 random bytes or stronger, matching the sandbox
- `VIEW_PORTAL_READY=false`

Never replace production Supabase keys with test-project keys. No branch server
key is needed on the controller; it only signs fixed-persona handoffs.

Production merge/deployment and environment changes require explicit owner
approval. Readiness remains false until real handoff and isolation acceptance.
The standalone sandbox branch must never be merged into main because it removes
scheduled jobs specifically for the isolated test host.

## Verification and dependency patch

The September 23 review found middleware-bypass and other advisories in the
existing Next.js 15.5.15 dependency. This branch updates Next.js and
eslint-config-next to 15.5.26, refreshes compatible sharp/ws dependencies, and
overrides Next.js's old PostCSS dependency with 8.5.28 without a major Next.js
upgrade ([middleware advisory](https://github.com/advisories/GHSA-26hh-7cqf-hhc6),
[PostCSS advisory](https://github.com/advisories/GHSA-r28c-9q8g-f849)).

The Next production build passed. Three dedicated launcher API tests passed,
alongside the existing regression suite with 1,827 Node tests. The runtime
dependency audit (`npm audit --omit=dev`) returned zero known vulnerabilities.
Development-only dependency advisories remain outside this narrowly scoped
runtime patch; this is not a claim of a completely clean dependency audit.

Owner MFA enrollment was confirmed by a read-only factor-status query. This
confirms enrollment, not an authenticated AAL2 session in a particular browser.
Real cross-host handoff acceptance remains pending.
