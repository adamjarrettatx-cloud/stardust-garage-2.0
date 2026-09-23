import { NextResponse } from 'next/server';
import { requireTeam } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { validateMainContactRequest } from '@/lib/contact-organizations';

export const runtime = 'nodejs';
function failure(error) {
  const status = error?.code === '42501' ? 403 : error?.code === 'P0002' ? 404
    : ['23505', '40001'].includes(error?.code) ? 409 : ['22023', '23514'].includes(error?.code) ? 400 : 503;
  return NextResponse.json({ error: status === 503 ? 'Organization contacts are temporarily unavailable. Please try again.' : error.message }, { status });
}
export async function GET(request, { params }) {
  const { unauthorized } = await requireTeam();
  if (unauthorized) return NextResponse.json({ error: 'Team access required.' }, { status: 401 });
  const { id } = await params;
  const db = await createClient();
  const { data, error } = await db.rpc('get_organization_main_contact', { p_organization_id: id });
  if (error) return failure(error);
  const q = new URL(request.url).searchParams.get('q');
  let candidates = [];
  if (q != null) {
    if (q.trim().length < 2 || q.length > 120) return NextResponse.json({ error: 'Search using 2–120 characters.' }, { status: 400 });
    const result = await db.rpc('search_organization_people', { p_query: q });
    if (result.error) return failure(result.error);
    candidates = result.data || [];
  }
  return NextResponse.json({ ...data, candidates }, { headers: { 'Cache-Control': 'private, no-store' } });
}
export async function PUT(request, { params }) {
  const { unauthorized } = await requireTeam();
  if (unauthorized) return NextResponse.json({ error: 'Team access required.' }, { status: 401 });
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  const parsed = validateMainContactRequest(await request.json().catch(() => null));
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { id } = await params;
  const { mode, id: personId, person, expectedVersion } = parsed.value;
  const db = await createClient();
  const { data, error } = await db.rpc('set_organization_main_contact', {
    p_organization_id: id, p_mode: mode, p_person_id: personId,
    p_name: person.name, p_email: person.email, p_phone: person.phone, p_expected_version: expectedVersion,
  });
  return error ? failure(error) : NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
}
