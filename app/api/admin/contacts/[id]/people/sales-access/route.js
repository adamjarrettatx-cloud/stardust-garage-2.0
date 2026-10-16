import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PATCH: turn a linked person's event sales access on or off. Admin-only,
// because it discloses buyer names and emails for the organization's events.
// The database function re-checks admin and writes the audit history.
export async function PATCH(request) {
  const { unauthorized } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Only an admin can change event sales access.' }, { status: 401 });
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (!body || !UUID.test(body.linkId || '') || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const db = await createClient();
  const { data, error } = await db.rpc('set_organization_person_sales_access', {
    p_link_id: body.linkId, p_enabled: body.enabled,
  });
  if (error) {
    const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404
      : ['22023', '23514'].includes(error.code) ? 400 : 503;
    return NextResponse.json({ error: status === 503 ? 'Event sales access is temporarily unavailable. Please try again.' : error.message }, { status });
  }
  return NextResponse.json({ people: data || [] }, { headers: { 'Cache-Control': 'private, no-store' } });
}
