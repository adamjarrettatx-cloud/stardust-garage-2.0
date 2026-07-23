import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { parseImportCsv } from '@/lib/progress-csv';

// POST /api/progress/import — safe spreadsheet import for Admin/Owner. Accepts
// the raw CSV text (the columns the team already keeps: Department/Area,
// Deliverable, Status) and inserts one task per valid row.
//
// Safety: the free-form Status text is NEVER written as production status. It
// is mapped to our enum, and the original note is preserved into the task
// description so nothing is lost. Per-row errors are reported back rather than
// aborting the whole import. With dryRun=true the route validates and returns
// the parse result WITHOUT inserting, so an admin can preview first.
export async function POST(request) {
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.csv !== 'string') {
    return NextResponse.json({ error: 'csv text is required.' }, { status: 400 });
  }
  const dryRun = body.dryRun !== false; // default to preview unless explicitly false

  const { rows, errors, columns } = parseImportCsv(body.csv);
  if (!columns) {
    return NextResponse.json({ error: errors[0]?.message || 'Unparseable CSV.', errors }, { status: 400 });
  }

  if (dryRun) {
    return NextResponse.json({ dryRun: true, willImport: rows.length, rows, errors });
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No valid rows to import.', errors }, { status: 400 });
  }

  const inserts = rows.map((r) => ({
    title: r.title,
    department: r.department,
    status: r.status,
    // Preserve the original free-form note so no context is lost.
    description: r.statusNote ? `Imported status note: ${r.statusNote}` : null,
  }));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_tasks')
    .insert(inserts)
    .select('id');

  if (error) return NextResponse.json({ error: error.message, errors }, { status: 400 });
  return NextResponse.json({ imported: data?.length || 0, skipped: errors.length, errors });
}
