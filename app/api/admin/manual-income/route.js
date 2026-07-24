import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  validateManualEntry,
  buildManualInsert,
  buildManualUpdate,
  isSameOrigin,
  checkEventLink,
} from '@/lib/manual-income';

export const runtime = 'nodejs';

// OWNER-ONLY manual financial-calendar income (create / edit / delete).
//
// Security posture:
//   * requireOwner() — must be an authenticated admin whose auth.users email is
//     the canonical owner. Non-owner admins/team are rejected. Owner identity is
//     server-controlled and never read from client metadata.
//   * Same-origin check (isSameOrigin) — defense-in-depth against CSRF on top of
//     SameSite session cookies.
//   * Writes go through the service-role client only AFTER the owner gate; there
//     is no unrestricted client-side DB write. RLS (public.is_owner()) is the
//     final backstop.
//   * All input is validated/normalized server-side (validateManualEntry); money
//     is converted to integer cents safely. created_by is set from the session,
//     never trusted from the body.

async function guard(request) {
  if (!isSameOrigin(request.headers.get('origin'), request.headers.get('host'))) {
    return { error: NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 }) };
  }
  const { user, unauthorized } = await requireOwner();
  if (unauthorized) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { user };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// Confirm a client-supplied local_event_id references a real local event. We
// NEVER trust the raw id: we fetch the row server-side (service-role, already
// owner-gated) and let the pure checkEventLink() decide. Returns the verified
// id (or null when none was supplied). Throws on an unexpected DB error so the
// caller surfaces a 500 rather than silently unlinking.
async function verifyEventLink(supabase, localEventId) {
  if (localEventId == null || String(localEventId).trim() === '') {
    return { ok: true, localEventId: null };
  }
  const id = String(localEventId).trim();
  const { data, error } = await supabase
    .from('events')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return checkEventLink(id, data);
}

// POST — create a manual income entry.
export async function POST(request) {
  try {
    const g = await guard(request);
    if (g.error) return g.error;

    const body = await readJson(request);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

    const result = validateManualEntry(body);
    if (!result.valid) {
      return NextResponse.json({ error: 'Validation failed', fields: result.errors }, { status: 422 });
    }

    const supabase = createAdminClient();
    const link = await verifyEventLink(supabase, result.value.localEventId);
    if (!link.ok) {
      return NextResponse.json({ error: 'Validation failed', fields: { localEventId: link.error } }, { status: 422 });
    }
    result.value.localEventId = link.localEventId;

    const { data, error } = await supabase
      .from('manual_income_entries')
      .insert(buildManualInsert(result.value, { createdBy: g.user.id }))
      .select()
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, entry: data }, { status: 201 });
  } catch (err) {
    console.error('manual-income POST error:', err);
    return NextResponse.json({ error: 'Server error: ' + (err?.message || 'unknown') }, { status: 500 });
  }
}

// PATCH — edit an existing manual income entry by id.
export async function PATCH(request) {
  try {
    const g = await guard(request);
    if (g.error) return g.error;

    const body = await readJson(request);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

    const id = body.id != null ? String(body.id).trim() : '';
    if (!id) return NextResponse.json({ error: 'An entry id is required.' }, { status: 400 });

    const result = validateManualEntry(body);
    if (!result.valid) {
      return NextResponse.json({ error: 'Validation failed', fields: result.errors }, { status: 422 });
    }

    const supabase = createAdminClient();
    const link = await verifyEventLink(supabase, result.value.localEventId);
    if (!link.ok) {
      return NextResponse.json({ error: 'Validation failed', fields: { localEventId: link.error } }, { status: 422 });
    }
    result.value.localEventId = link.localEventId;

    const { data, error } = await supabase
      .from('manual_income_entries')
      .update(buildManualUpdate(result.value))
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: 'Entry not found.' }, { status: 404 });

    return NextResponse.json({ success: true, entry: data });
  } catch (err) {
    console.error('manual-income PATCH error:', err);
    return NextResponse.json({ error: 'Server error: ' + (err?.message || 'unknown') }, { status: 500 });
  }
}

// DELETE — remove a manual income entry by id (from JSON body or ?id=).
export async function DELETE(request) {
  try {
    const g = await guard(request);
    if (g.error) return g.error;

    const body = await readJson(request);
    const id = (body?.id ?? new URL(request.url).searchParams.get('id') ?? '').toString().trim();
    if (!id) return NextResponse.json({ error: 'An entry id is required.' }, { status: 400 });

    const supabase = createAdminClient();
    const { error } = await supabase.from('manual_income_entries').delete().eq('id', id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, id });
  } catch (err) {
    console.error('manual-income DELETE error:', err);
    return NextResponse.json({ error: 'Server error: ' + (err?.message || 'unknown') }, { status: 500 });
  }
}
