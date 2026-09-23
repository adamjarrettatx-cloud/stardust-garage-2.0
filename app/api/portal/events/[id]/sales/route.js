import { NextResponse } from 'next/server';
import { requirePartner, createRequestScopedClient } from '@/lib/auth-helpers';
import { profileCapabilities } from '@/lib/profile-capabilities';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request, { params }) {
  const { unauthorized, partner } = await requirePartner(request);
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  if (!profileCapabilities(partner.contact_type).events) return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
  const db = await createRequestScopedClient(request);
  const { data, error } = await db.rpc('partner_event_sales', { p_event_id: id });
  if (error) return NextResponse.json({ error: error.code === 'P0002' ? 'Not found' : 'Sales could not be refreshed.' }, { status: error.code === 'P0002' ? 404 : 503, headers });
  return NextResponse.json(data, { headers });
}
