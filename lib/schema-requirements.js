// Single source of truth for the production schema objects the running app
// hard-depends on, plus the pure logic that diffs "what the app needs" against
// "what the database actually has".
//
// WHY THIS EXISTS: PR #28 shipped code that filtered events by
// `visibility = 'public'`, but the matching migration
// (20260616_event_visibility_micro_party.sql) had not been applied to the
// production Supabase project. Every existing event lacked the column, the
// filter returned nothing, and the public /events page + team calendar went
// blank until the migration was applied by hand. A passing build told us
// nothing because the schema lives in a separate system from the deploy.
//
// The fix is a guard that asks the database, before/around a deploy, whether
// the columns and tables the code relies on are actually present. This module
// is the PURE half: it declares the requirements and computes the diff. It
// performs NO network I/O so it can be unit-tested and reused by both the CLI
// runner (scripts/check-required-schema.mjs) and the admin health route.

// Each requirement names a database object the app reads. `kind` is either
// 'column' (table + column must exist) or 'table' (table must exist).
// `since` records the PR/migration that introduced it — purely informational,
// surfaced in reports so an operator can map a miss back to a migration.
//
// Keep this list focused on objects whose ABSENCE silently breaks a
// user-facing surface (the PR #28 failure mode), not every column in the
// schema. Additive columns with safe code-side defaults still belong here when
// a query filters or selects on them in a way that misbehaves when missing.
export const REQUIRED_SCHEMA = [
  // PR #28 — the incident. Public/team event filtering keys on these.
  {
    kind: 'column',
    table: 'events',
    column: 'visibility',
    since: 'PR #28 / 20260616_event_visibility_micro_party.sql',
    note: "Public /events + team calendar filter on visibility = 'public'. Missing column => empty public events.",
  },
  {
    kind: 'column',
    table: 'events',
    column: 'event_type',
    since: 'PR #28 / 20260616_event_visibility_micro_party.sql',
    note: 'Micro-party classification; selected alongside visibility.',
  },

  // PR #23 — contract-terms snapshot columns on event_financial_config.
  {
    kind: 'column',
    table: 'event_financial_config',
    column: 'snapshot_stardust_split_percent',
    since: 'PR #23 / 20260616_event_financials_contract_snapshot.sql',
    note: 'Financials calc falls back to snapshot terms when a contract is deleted.',
  },
  {
    kind: 'column',
    table: 'event_financial_config',
    column: 'snapshot_flat_fee_cents',
    since: 'PR #23 / 20260616_event_financials_contract_snapshot.sql',
  },
  {
    kind: 'column',
    table: 'event_financial_config',
    column: 'snapshot_revenue_share_recipient',
    since: 'PR #23 / 20260616_event_financials_contract_snapshot.sql',
  },
  {
    kind: 'column',
    table: 'event_financial_config',
    column: 'snapshot_taken_at',
    since: 'PR #23 / 20260616_event_financials_contract_snapshot.sql',
  },
  {
    kind: 'column',
    table: 'event_financial_config',
    column: 'snapshot_contract_id',
    since: 'PR #23 / 20260616_event_financials_contract_snapshot.sql',
  },

  // PR #19 — event financials + POS import tables.
  {
    kind: 'table',
    table: 'event_financial_config',
    since: 'PR #19 / 20260616_event_financials.sql',
    note: 'Per-event fee/split inputs. Admin financials page reads this.',
  },
  {
    kind: 'table',
    table: 'pos_import_batches',
    since: 'PR #19 / 20260616_event_financials.sql',
    note: 'One row per POS CSV upload.',
  },
  {
    kind: 'table',
    table: 'pos_import_rows',
    since: 'PR #19 / 20260616_event_financials.sql',
    note: 'Parsed POS rows feeding the financials calc.',
  },
];

// Stable identifier for a requirement, used as a map key and in reports.
//   column -> "public.events.visibility"
//   table  -> "public.event_financial_config"
export function requirementKey(req, schema = 'public') {
  if (req.kind === 'column') {
    return `${schema}.${req.table}.${req.column}`;
  }
  return `${schema}.${req.table}`;
}

// Build the set of object keys actually present in the database from raw
// information_schema rows. The runner fetches these; this function shapes them
// into the same key space requirementKey() produces, so the diff is a plain
// set-membership check.
//
//   columnRows: [{ table_schema, table_name, column_name }, ...]
//   tableRows:  [{ table_schema, table_name }, ...]
export function buildPresentSet({ columnRows = [], tableRows = [] } = {}) {
  const present = new Set();
  for (const r of tableRows) {
    if (!r) continue;
    const schema = r.table_schema ?? 'public';
    if (r.table_name) present.add(`${schema}.${r.table_name}`);
  }
  for (const r of columnRows) {
    if (!r) continue;
    const schema = r.table_schema ?? 'public';
    if (r.table_name && r.column_name) {
      present.add(`${schema}.${r.table_name}.${r.column_name}`);
      // A present column implies a present table.
      present.add(`${schema}.${r.table_name}`);
    }
  }
  return present;
}

// PURE diff: given the requirement list and the set of present object keys,
// return a structured report. `ok` is true only when nothing is missing.
//
//   { ok, checked, missing: [{ key, kind, table, column?, since?, note? }], present: [key,...] }
export function diffSchema(present, requirements = REQUIRED_SCHEMA, schema = 'public') {
  const presentSet = present instanceof Set ? present : new Set(present || []);
  const missing = [];
  const ok = [];

  for (const req of requirements) {
    const key = requirementKey(req, schema);
    if (presentSet.has(key)) {
      ok.push(key);
    } else {
      missing.push({
        key,
        kind: req.kind,
        table: req.table,
        column: req.column,
        since: req.since,
        note: req.note,
      });
    }
  }

  return {
    ok: missing.length === 0,
    checked: requirements.length,
    missing,
    present: ok,
  };
}

// Distinct table names referenced by the requirements — handy for building a
// narrow information_schema query (WHERE table_name IN (...)) instead of
// scanning the whole catalog.
export function requiredTableNames(requirements = REQUIRED_SCHEMA) {
  return [...new Set(requirements.map((r) => r.table))];
}

// Classify a PostgREST/Postgres error from a head-only probe into one of:
//   'missing_table'  — the relation does not exist (42P01 / PGRST205)
//   'missing_column' — the column does not exist (42703 / PGRST204)
//   null             — not a "missing object" error; the probe could not
//                      determine presence and the caller must treat it as
//                      "cannot verify" rather than "missing" or "present".
//
// Pure so it can be unit-tested against representative supabase-js error
// shapes and shared by both the CLI runner and the admin health probe (no
// duplicated, untested copies). Matches on both the structured `code` and a
// lowercased `message`, since supabase-js surfaces different shapes depending
// on whether the error comes from PostgREST schema cache or Postgres directly.
export function classifyProbeError(error) {
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

// Build the head-only probe arguments for a requirement. Selecting a column by
// name forces PostgREST to validate it (returning 42703/PGRST204 when absent);
// a table probe selects '*'. `head: true` returns no rows, so no row data is
// read regardless of RLS. Kept pure so both probe call sites stay identical.
export function probeSelect(req) {
  return req.kind === 'column' ? `"${req.column}"` : '*';
}

// Given a probe result error (or null on success), decide presence:
//   true  — object exists (no error)
//   false — object is absent (recognized missing-table/column error)
//   null  — could not determine (unrecognized error)
export function presenceFromProbeError(error) {
  if (!error) return true;
  const cls = classifyProbeError(error);
  if (cls === 'missing_table' || cls === 'missing_column') return false;
  return null;
}

// Human-readable one-liner per missing object, for CLI output and the admin
// health page. Kept here (pure) so both renderers stay consistent.
export function formatMissing(missing) {
  return missing.map((m) => {
    const what = m.kind === 'column' ? `column ${m.key}` : `table ${m.key}`;
    const since = m.since ? ` [${m.since}]` : '';
    const note = m.note ? ` — ${m.note}` : '';
    return `MISSING ${what}${since}${note}`;
  });
}
