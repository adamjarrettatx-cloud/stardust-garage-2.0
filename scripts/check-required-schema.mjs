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
// PostgREST returns a structured error when the table (42P01 / PGRST205) or
// column (42703 / PGRST204) is absent, which we map to "missing". A normal
// (empty) result means the object exists. RLS does not matter here because we
// use the service-role key, which bypasses RLS, and we never read row data.
//
// USAGE:
//   npm run check:schema                 # check production
//   node scripts/check-required-schema.mjs
//
// ENV (server-side; never hardcode secrets):
//   NEXT_PUBLIC_SUPABASE_URL       required
//   SUPABASE_SERVICE_ROLE_KEY      preferred (bypasses RLS)
//   NEXT_PUBLIC_SUPABASE_ANON_KEY  fallback if service role is unavailable
//
// EXIT CODES:
//   0  all required objects present
//   1  one or more required objects missing
//   2  could not run the check (missing env / connection error)
//
// In CI/build, gate this behind an explicit flag (REQUIRE_SCHEMA_CHECK=1) so
// local dev and preview builds without Supabase env vars are never blocked.

import { createClient } from '@supabase/supabase-js';
import {
  REQUIRED_SCHEMA,
  diffSchema,
  buildPresentSet,
  formatMissing,
  requirementKey,
} from '../lib/schema-requirements.js';

const SCHEMA = 'public';

function getEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const key = serviceKey || anonKey;
  return { url, key, usingServiceRole: Boolean(serviceKey) };
}

// Map a PostgREST/Postgres error to one of: 'missing_table', 'missing_column',
// or null (not a "missing object" error — treat as a hard failure to probe).
function classifyError(error) {
  if (!error) return null;
  const code = error.code || '';
  const msg = (error.message || '').toLowerCase();

  // Undefined table.
  if (code === '42P01' || code === 'PGRST205') return 'missing_table';
  if (msg.includes('does not exist') && msg.includes('relation')) return 'missing_table';
  if (msg.includes('could not find the table')) return 'missing_table';

  // Undefined column.
  if (code === '42703' || code === 'PGRST204') return 'missing_column';
  if (msg.includes('column') && msg.includes('does not exist')) return 'missing_column';
  if (msg.includes('could not find the') && msg.includes('column')) return 'missing_column';

  return null;
}

// Probe a single requirement against the live DB. Returns:
//   { present: true }                       object exists
//   { present: false }                       object is absent
//   { present: null, error }                 couldn't determine (probe failed)
async function probe(supabase, req) {
  const selectExpr = req.kind === 'column' ? `"${req.column}"` : '*';
  const { error } = await supabase
    .from(req.table)
    .select(selectExpr, { head: true, count: 'exact' })
    .limit(0);

  if (!error) return { present: true };

  const cls = classifyError(error);
  if (cls === 'missing_table' || cls === 'missing_column') {
    return { present: false };
  }
  return { present: null, error };
}

async function main() {
  const { url, key, usingServiceRole } = getEnv();

  if (!url || !key) {
    console.error(
      '[check:schema] Missing Supabase env. Need NEXT_PUBLIC_SUPABASE_URL and ' +
        'SUPABASE_SERVICE_ROLE_KEY (preferred) or NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    );
    console.error('[check:schema] Set them to point at the environment you want to verify (e.g. production).');
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
