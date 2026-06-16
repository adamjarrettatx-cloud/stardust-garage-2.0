// Server-only schema-health probe, reused by the admin health page.
//
// Shares the requirement list + pure diff with the CLI guard
// (scripts/check-required-schema.mjs) via lib/schema-requirements.js. The only
// difference is the transport: here we use the service-role admin client that
// the rest of app/api/** already uses, instead of spinning up a standalone
// client. NEVER import this from a client component — it touches the
// service-role key.

import { createAdminClient } from '@/lib/supabase/admin';
import {
  REQUIRED_SCHEMA,
  diffSchema,
  requirementKey,
} from '@/lib/schema-requirements';

const SCHEMA = 'public';

function classifyError(error) {
  if (!error) return null;
  const code = error.code || '';
  const msg = (error.message || '').toLowerCase();
  if (code === '42P01' || code === 'PGRST205') return 'missing_table';
  if (msg.includes('does not exist') && msg.includes('relation')) return 'missing_table';
  if (msg.includes('could not find the table')) return 'missing_table';
  if (code === '42703' || code === 'PGRST204') return 'missing_column';
  if (msg.includes('column') && msg.includes('does not exist')) return 'missing_column';
  if (msg.includes('could not find the') && msg.includes('column')) return 'missing_column';
  return null;
}

async function probe(supabase, req) {
  const selectExpr = req.kind === 'column' ? `"${req.column}"` : '*';
  const { error } = await supabase
    .from(req.table)
    .select(selectExpr, { head: true, count: 'exact' })
    .limit(0);
  if (!error) return { present: true };
  const cls = classifyError(error);
  if (cls === 'missing_table' || cls === 'missing_column') return { present: false };
  return { present: null, error };
}

// Returns a report the admin page can render directly:
//   { configured, ok, checked, missing, present, probeErrors }
// `configured` is false when Supabase server env is absent (e.g. preview/dev),
// in which case we report "unknown" rather than a false "healthy".
export async function getSchemaHealth() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      configured: false,
      ok: null,
      checked: REQUIRED_SCHEMA.length,
      missing: [],
      present: [],
      probeErrors: [],
    };
  }

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (e) {
    return {
      configured: false,
      ok: null,
      checked: REQUIRED_SCHEMA.length,
      missing: [],
      present: [],
      probeErrors: [{ key: 'client', message: e?.message || String(e) }],
    };
  }

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
      presentSet.add(`${SCHEMA}.${req.table}`);
    } else if (result.present === null) {
      probeErrors.push({ key, message: result.error?.message || String(result.error) });
    }
  }

  if (probeErrors.length > 0) {
    return {
      configured: true,
      ok: null,
      checked: REQUIRED_SCHEMA.length,
      missing: [],
      present: [...presentSet],
      probeErrors,
    };
  }

  const report = diffSchema(presentSet, REQUIRED_SCHEMA, SCHEMA);
  return {
    configured: true,
    ok: report.ok,
    checked: report.checked,
    missing: report.missing,
    present: report.present,
    probeErrors: [],
  };
}
