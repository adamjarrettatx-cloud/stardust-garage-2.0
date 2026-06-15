import { NextResponse } from 'next/server';
import { requireTeam, requireAdmin } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import {
  CAPACITY_OPERATIONS,
  deriveStatus,
  isValidSource,
  parseMaxCapacity,
  mapRpcError,
} from '@/lib/capacity-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/capacity/operation
// Body: { op, source?, note?, max_capacity?, name?, target? }
//
// Single entry point for every mutation. The op is dispatched through the
// CAPACITY_OPERATIONS table to a SECURITY DEFINER RPC. We gate at the route
// (requireTeam / requireAdmin) AND the RPC re-checks role internally, so even a
// forged request that slips past the route is refused by the database.
//
// Mutations run on the USER-SCOPED client (not service-role) so auth.uid() is
// the real caller — that drives both the DB role check and the audit log's
// actor_id. Least privilege: this route never holds the service-role key.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'bad_input' }, { status: 400 });
  }

  const op = body?.op;
  const config = CAPACITY_OPERATIONS[op];
  if (!config) {
    return NextResponse.json({ error: 'Unknown operation', code: 'bad_input' }, { status: 400 });
  }

  // Route-level role gate matching the RPC's required role.
  const gate = config.role === 'admin' ? await requireAdmin() : await requireTeam();
  if (gate.unauthorized) {
    return NextResponse.json({ error: 'Unauthorized', code: 'forbidden' }, { status: 401 });
  }

  const source = isValidSource(body?.source) ? body.source : config.defaultSource;
  const note = typeof body?.note === 'string' ? body.note.slice(0, 280) : null;

  // Build the RPC argument set per operation.
  let args;
  if (op === 'start') {
    const max = parseMaxCapacity(body?.max_capacity);
    if (max === null) {
      return NextResponse.json({ error: 'Max capacity must be a positive number.', code: 'bad_input' }, { status: 400 });
    }
    const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : 'Tonight';
    args = { p_name: name, p_max: max };
  } else if (op === 'end') {
    args = { p_note: note };
  } else if (op === 'adjust') {
    const target = Number(body?.target);
    if (!Number.isInteger(target) || target < 0) {
      return NextResponse.json({ error: 'Target must be a non-negative integer.', code: 'bad_input' }, { status: 400 });
    }
    args = { p_target: target, p_source: source, p_note: note };
  } else {
    // check_in / check_out / reset
    args = { p_source: source, p_note: note };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(config.rpc, args);

  if (error) {
    const mapped = mapRpcError(error);
    return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.httpStatus });
  }

  // RPCs return the full session row.
  const session = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ ok: true, session: session || null, status: deriveStatus(session) });
}
