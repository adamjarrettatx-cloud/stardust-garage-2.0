import { NextResponse } from 'next/server';
import { isViewPortalSandbox, PREVIEW_ONLY_MESSAGE } from '@/lib/view-portal/preview-only';
import { createRequestScopedClient, requirePartner } from '@/lib/auth-helpers';
import { profileCapabilities } from '@/lib/profile-capabilities';
import { pitchErrorResponse } from '@/lib/date-pitches';

export const runtime = 'nodejs';

// POST /api/portal/pitches/:id/withdraw — only the Programmer's own pending
// pitch can be withdrawn; anything else reads back as not found.
export async function POST(request, { params }) {
  if (isViewPortalSandbox()) return NextResponse.json({ error: PREVIEW_ONLY_MESSAGE }, { status: 403 });
  const { partner, unauthorized } = await requirePartner(request);
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!profileCapabilities(partner?.contact_type).pitches) {
    return NextResponse.json({ error: 'Date pitches are not available for this profile.' }, { status: 403 });
  }
  const { id } = await params;
  const supabase = await createRequestScopedClient(request);
  const { data, error } = await supabase.rpc('partner_withdraw_pitch', { p_id: id });
  if (error) {
    const r = pitchErrorResponse(error);
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
  if (!data) return NextResponse.json({ error: 'This pitch is no longer pending.' }, { status: 409 });
  return NextResponse.json({ ok: true });
}
