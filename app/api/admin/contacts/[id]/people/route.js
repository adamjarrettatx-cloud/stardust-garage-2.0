import { NextResponse } from 'next/server';
import { requireTeam } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { validateOrganizationPersonRequest } from '@/lib/contact-organizations';

export const runtime = 'nodejs';
const noStore = { headers: { 'Cache-Control': 'private, no-store' } };
function failure(error) {
  const status = error?.code === '42501' ? 403 : error?.code === 'P0002' ? 404
    : ['23505', '40001'].includes(error?.code) ? 409 : ['22023', '23514'].includes(error?.code) ? 400 : 503;
  return NextResponse.json({ error: status === 503 ? 'Organization people are temporarily unavailable. Please try again.' : error.message }, { status });
}
async function gate(request, write) {
  const { unauthorized } = await requireTeam();
  if (unauthorized) return NextResponse.json({ error: 'Team access required.' }, { status: 401 });
  if (write && request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  return null;
}

// GET: linked people, plus search candidates when ?q= is supplied.
export async function GET(request, { params }) {
  const blocked = await gate(request, false);
  if (blocked) return blocked;
  const { id } = await params;
  const db = await createClient();
  const { data, error } = await db.rpc('get_organization_people', { p_organization_id: id });
  if (error) return failure(error);
  const q = new URL(request.url).searchParams.get('q');
  let candidates = [];
  if (q != null) {
    if (q.trim().length < 2 || q.length > 120) return NextResponse.json({ error: 'Search using 2–120 characters.' }, { status: 400 });
    const result = await db.rpc('search_organization_people', { p_query: q });
    if (result.error) return failure(result.error);
    candidates = result.data || [];
  }
  return NextResponse.json({ people: data || [], candidates }, noStore);
}

async function write(request, params, method) {
  const blocked = await gate(request, true);
  if (blocked) return blocked;
  const parsed = validateOrganizationPersonRequest(method, await request.json().catch(() => null));
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { id } = await params;
  const db = await createClient();
  const v = parsed.value;
  const { data, error } = method === 'POST'
    ? await db.rpc('add_organization_person', {
      p_organization_id: id, p_mode: v.mode, p_person_id: v.id,
      p_name: v.person.name, p_email: v.person.email, p_phone: v.person.phone, p_role: v.role,
    })
    : method === 'PATCH'
      ? await db.rpc('update_organization_person', { p_link_id: v.linkId, p_role: v.role })
      : await db.rpc('remove_organization_person', { p_link_id: v.linkId });
  return error ? failure(error) : NextResponse.json({ people: data || [] }, noStore);
}
export const POST = (request, context) => write(request, context.params, 'POST');
export const PATCH = (request, context) => write(request, context.params, 'PATCH');
export const DELETE = (request, context) => write(request, context.params, 'DELETE');
