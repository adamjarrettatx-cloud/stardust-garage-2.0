import { NextResponse } from 'next/server';
import { requireTeam } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// GET: organizations this person is linked to (main contact or additional person).
export async function GET(request, { params }) {
  const { unauthorized } = await requireTeam();
  if (unauthorized) return NextResponse.json({ error: 'Team access required.' }, { status: 401 });
  const { id } = await params;
  const db = await createClient();
  const { data, error } = await db.rpc('get_person_organizations', { p_person_id: id });
  if (error) {
    const status = error.code === '42501' ? 403 : 503;
    return NextResponse.json({ error: status === 403 ? error.message : 'Organizations are temporarily unavailable. Please try again.' }, { status });
  }
  return NextResponse.json({ organizations: data || [] }, { headers: { 'Cache-Control': 'private, no-store' } });
}
