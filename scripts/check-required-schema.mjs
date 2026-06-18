#!/usr/bin/env node
// Production schema guard.
//
// Connects to Supabase with server credentials and verifies that the database
// actually contains the columns/tables the deployed code depends on. This is
// the network half of the guard; the pure requirement list + diff logic lives
// in lib/schema-requirements.js and is unit-tested separately.
//
// WHY: PR #28 deployed code that filtered events by `visibility = 'public'`
// before the matching migration was applied to production. The public /events
// page and team calendar went blank. A build/test pass cannot catch this
// because the schema is a separate system — only asking the live database can.
//
// HOW IT PROBES: rather than relying on a custom information_schema RPC (which
// may not exist), it asks PostgREST for each required object directly:
//   * column check  -> select "<column>" from "<table>" limit 0
//   * table check   -> select * from "<table>" limit 0
// Selecting a column by name forces PostgREST to validate it: when the table
// (42P01 / PGRST205) or column (42703 / PGRST204) is absent it returns a
// structured ERROR, which we map to "missing" — it does NOT silently return an
// empty result set. A successful (no-error) head response means the object
// exists. RLS does not matter here because we use the service-role key, which
// bypasses RLS, and we never read row data (`head: true`).
//
// USAGE:
//   npm run check:schema                 # explicit run; missing env => exit 2
//   npm run check:schema:ci              # CI-friendly; honors REQUIRE_SCHEMA_CHECK
//   node scripts/check-required-schema.mjs
//
// ENV (server-side; never hardcode secrets):
//   NEXT_PUBLIC_SUPABASE_URL       required
//   SUPABASE_SERVICE_ROLE_KEY      preferred (bypasses RLS)
//   NEXT_PUBLIC_SUPABASE_ANON_KEY  fallback if service role is unavailable
//
// REQUIRE_SCHEMA_CHECK controls what happens when Supabase env is ABSENT, so a
// CI/build step can invoke this unconditionally without breaking envless local
// or preview builds:
//   * unset / "0" / "false"  => missing env is a SOFT SKIP (exit 0). Safe to
//                               wire into a build step that may run without
//                               credentials.
//   * "1" / "true"           => missing env is a HARD FAILURE (exit 2). Use in
//                               an environment that is SUPPOSED to have prod
//                               credentials, so a misconfigured pipeline fails
//                               loudly instead of silently skipping the gate.
// When env IS present the flag has no effect — the check always runs and its
// exit code reflects the schema (0 ok / 1 missing). The flag never makes a
// normal build fail for lack of credentials unless you opt in by setting it.
//
// EXIT CODES:
//   0  all required objects present (or env absent and check not required)
//   1  one or more required objects missing
//   2  could not run the check (env required-but-absent, or connection error)

import { createClient } from '@supabase/supabase-js';
import {
  REQUIRED_SCHEMA,
  diffSchema,
  formatMissing,
  requirementKey,
  presenceFromProbeError,
  probeSelect,
} from '../lib/schema-requirements.js';

const SCHEMA = 'public';

function getEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const key = serviceKey || anonKey;
  return { url, key, usingServiceRole: Boolean(serviceKey) };
}

// True when the operator has explicitly required the check to run (so missing
// env is a failure rather than a skip). Anything other than 1/true is "off".
function schemaCheckRequired() {
  const v = (process.env.REQUIRE_SCHEMA_CHECK || '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

// Probe a single requirement against the live DB. Returns:
//   { present: true }                       object exists
//   { present: false }                       object is absent
//   { present: null, error }                 couldn't determine (probe failed)
async function probe(supabase, req) {
  const { error } = await supabase
    .from(req.table)
    .select(probeSelect(req), { head: true })
    .limit(0);

  const present = presenceFromProbeError(error);
  return present === null ? { present: null, error } : { present };
}

async function main() {
  const { url, key, usingServiceRole } = getEnv();

  if (!url || !key) {
    if (!schemaCheckRequired()) {
      console.warn(
        '[check:schema] Supabase env not set — skipping schema check ' +
          '(REQUIRE_SCHEMA_CHECK is not enabled). Safe to ignore in local/preview builds.'
      );
      process.exit(0);
    }
    console.error(
      '[check:schema] Missing Supabase env. Need NEXT_PUBLIC_SUPABASE_URL and ' +
        'SUPABASE_SERVICE_ROLE_KEY (preferred) or NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    );
    console.error(
      '[check:schema] REQUIRE_SCHEMA_CHECK is enabled, so this is a hard failure. ' +
        'Set the env vars to point at the environment you want to verify (e.g. production).'
    );
    process.exit(2);
  }

  if (!usingServiceRole) {
    console.warn(
      '[check:schema] Using the anon key. RLS will not hide schema shape for ' +
        'these head-only probes, but SUPABASE_SERVICE_ROLE_KEY is preferred.'
    );
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const presentSet = new Set();
  const probeErrors = [];

  for (const req of REQUIRED_SCHEMA) {
    const key = requirementKey(req, SCHEMA);
    let result;
    try {
      result = await probe(supabase, req);
    } catch (e) {
      result = { present: null, error: e };
    }

    if (result.present === true) {
      presentSet.add(key);
      // A present column implies a present table.
      presentSet.add(`${SCHEMA}.${req.table}`);
    } else if (result.present === null) {
      probeErrors.push({ key, error: result.error });
    }
    // present === false => simply leave it out of presentSet (counted missing).
  }

  // If we couldn't even probe (network/permission), don't claim "all good".
  if (probeErrors.length > 0) {
    console.error('[check:schema] Could not verify the schema — probe errors:');
    for (const pe of probeErrors) {
      console.error(`  ? ${pe.key}: ${pe.error?.message || pe.error}`);
    }
    process.exit(2);
  }

  const report = diffSchema(presentSet, REQUIRED_SCHEMA, SCHEMA);

  console.log(
    `[check:schema] Checked ${report.checked} required object(s) against ${url}`
  );

  if (report.ok) {
    console.log('[check:schema] OK — all required schema objects are present.');
    process.exit(0);
  }

  console.error(`[check:schema] FAIL — ${report.missing.length} required object(s) missing:`);
  for (const line of formatMissing(report.missing)) {
    console.error(`  ${line}`);
  }
  console.error(
    '\n[check:schema] Apply the matching Supabase migration(s) before deploying ' +
      'code that depends on these objects. See docs/deployment-checklist.md.'
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('[check:schema] Unexpected error:', e?.message || e);
  process.exit(2);
});
