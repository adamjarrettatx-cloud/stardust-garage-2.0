# Deployment Checklist & Schema Guard

This runbook prevents a repeat of the **PR #28 incident**: code that filtered
events by `visibility = 'public'` was merged and deployed to Vercel **before**
the matching Supabase migration (`20260616_event_visibility_micro_party.sql`)
was applied to production. Every existing event lacked the `visibility` column,
so the `.eq('visibility', 'public')` query errored at the database (PostgREST
returns an "undefined column" error, not an empty result), and the public
`/events` page and the team calendar went blank until the migration was applied
by hand.

The root cause is structural: **the build and the database are two separate
systems.** `npm run build` and the test suite can be perfectly green while
production is missing a column the code depends on. The only way to catch this
is to ask the live database whether the required schema objects exist.

---

## The schema guard

`npm run check:schema` connects to a Supabase project and verifies that the
columns/tables the deployed code depends on actually exist. It exits non-zero
if anything is missing.

```bash
# Verify production (point env at the prod project)
NEXT_PUBLIC_SUPABASE_URL="https://<prod-ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<prod-service-role-key>" \
npm run check:schema
```

- Exit `0` — all required objects present (or env absent and the check is not
  required; see CI integration below).
- Exit `1` — one or more required objects missing (apply the migration!).
- Exit `2` — could not run the check (connection/permission error, or env
  absent while `REQUIRE_SCHEMA_CHECK` is enabled).

**Never hardcode the project ref or keys.** Pass them via environment. The
production project is `stardust-garage`; its ref and keys live in your
password manager / Vercel project settings, not in the repo.

### What it checks

The required-objects list lives in [`lib/schema-requirements.js`](../lib/schema-requirements.js)
(pure, unit-tested). It currently covers:

| Object | Introduced by |
| --- | --- |
| `public.events.visibility` | PR #28 — the incident |
| `public.events.event_type` | PR #28 |
| `public.event_financial_config` (+ POS import tables `pos_import_batches`, `pos_import_rows`) | PR #19 |
| `public.event_financial_config.snapshot_*` columns | PR #23 |

**When you ship a PR that depends on a new column or table, add it to
`REQUIRED_SCHEMA` in the same PR.** That is how the guard stays honest.

### In-app health view

Admins can also open **Admin → Team → Schema Health**
(`/admin/schema-health`) for the same check from inside the app. Use it for a
quick post-deploy confirmation without shell access.

### CI / build integration (opt-in)

The check is **not** run automatically during `npm run build`, so local dev and
Vercel preview builds without Supabase env vars are never blocked. To enforce it
in a pipeline, run it as its own step with `check:schema:ci`:

```bash
# In CI, with production credentials in the environment:
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run check:schema:ci
```

`check:schema:ci` sets `REQUIRE_SCHEMA_CHECK=1`, which changes ONLY what happens
when the Supabase env vars are **absent**:

- **`npm run check:schema`** (flag off) — missing env is a **soft skip** (exit
  `0`). Safe to invoke in a build step that may run without credentials; it
  never fails a normal build for lack of env.
- **`npm run check:schema:ci`** (flag on) — missing env is a **hard failure**
  (exit `2`). Use it where credentials are *supposed* to be present, so a
  misconfigured pipeline fails loudly instead of silently skipping the gate.

When the env vars **are** present, the flag has no effect — the check runs
either way and the exit code reflects the schema (`0` ok / `1` missing). Keep
this a discrete CI step, never part of `build`, so unrelated builds are never
coupled to schema verification.

---

## Checklist: shipping a schema-dependent PR

Use this whenever a PR adds/changes a column, table, RLS policy, or function
that runtime code reads.

### Before merge

- [ ] Migration SQL is committed under `supabase/migrations/` and is **additive
      and safe to re-run** (`add column if not exists`, `create table if not
      exists`, etc.), matching the existing migrations' style.
- [ ] New required objects are added to `REQUIRED_SCHEMA` in
      `lib/schema-requirements.js` **in the same PR** as the code that depends
      on them.
- [ ] Code tolerates the pre-migration state where reasonable (e.g.
      `lib/event-visibility.js` treats a missing `visibility` as `'public'` so
      legacy rows are never hidden). Prefer safe defaults over hard failures.
- [ ] `npm test`, `npm run lint`, and `npm run build` pass locally.

### Apply the migration to production FIRST

- [ ] Apply the migration to the production Supabase project **before** the
      Vercel deploy goes live. Two safe orderings:
  - **Migration → then merge/deploy** (preferred): apply SQL, confirm with the
    guard, then merge.
  - **Backward-compatible deploy → migrate → enable**: only if the new code
    path is feature-flagged off until the column exists.
- [ ] Run the guard against production and confirm exit `0`:
      ```bash
      NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run check:schema
      ```

### After deploy

- [ ] Re-run `npm run check:schema` against production (or open
      `/admin/schema-health`) — confirm **HEALTHY**.
- [ ] Smoke-test the affected public surfaces:
  - [ ] `/events` lists public events (not empty).
  - [ ] `/events/[slug]` for a known public event loads.
  - [ ] `/home` events tile renders.
- [ ] Smoke-test the affected admin/team surfaces:
  - [ ] `/admin/calendar` (team calendar) shows events.
  - [ ] `/admin` dashboard event sections render.
  - [ ] Any new admin feature from the PR works end-to-end.

---

## Incident response: public events / calendar suddenly empty

This is the PR #28 signature. Work top to bottom.

1. **Confirm the cause.** Run the guard against production:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run check:schema
   ```
   A non-zero exit naming `public.events.visibility` (or another object)
   confirms schema drift — the deploy raced ahead of the migration.

2. **Fix forward (preferred): apply the missing migration.** The migrations are
   additive and safe. In the Supabase SQL editor for the production project,
   run the missing migration file from `supabase/migrations/` (e.g.
   `20260616_event_visibility_micro_party.sql`). Because every column is added
   `if not exists` with a sensible default, existing rows immediately become
   visible again (`visibility` defaults to `'public'`).

3. **Verify.** Re-run the guard (expect exit `0`) and reload `/events`,
   `/events/[slug]`, `/home`, and `/admin/calendar`.

4. **If a migration cannot be applied immediately (rollback path):** redeploy
   the previous Vercel deployment that did **not** depend on the new column
   (Vercel → Deployments → previous build → "Promote to Production" /
   "Rollback"). This restores the prior code that did not filter on the missing
   column. Then apply the migration and redeploy forward when ready.

5. **Post-incident:** ensure the object that was missing is listed in
   `REQUIRED_SCHEMA` so the guard would have caught it, and that the CI step is
   running for production deploys.
