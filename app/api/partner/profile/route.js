import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requirePartner } from '@/lib/auth-helpers';

export const runtime = 'nodejs';

const PHOTO_PATH_PREFIX = '/storage/v1/object/public/member-photos/';

// PATCH /api/partner/profile
// Body: { fullName: string, photoUrl?: string }
//
// The only way a partner edits their own record. Two columns, both of which
// door staff read off a screen on the night.
//
// SECURITY: this uses the caller's own session rather than the service-role
// client, and that is the point. Partners hold a column-level UPDATE grant on
// (full_name, photo_url) only — see 20260729_guest_list_partners.sql — so even
// if this route were tricked into passing is_active or contact_id through, the
// database would refuse the statement. /api/partner/complete-activation is
// service-role precisely because it must write is_active; nothing here does.
// The row is always the caller's own: user_id comes from the session, never the
// body.
export async function PATCH(request) {
  try {
    const { user, unauthorized } = await requirePartner();
    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : '';
    const photoUrl = typeof body?.photoUrl === 'string' ? body.photoUrl.trim() : '';

    if (!fullName) {
      return NextResponse.json({ error: 'Your name is required.' }, { status: 400 });
    }

    const updates = { full_name: fullName };

    // Activation made the photo mandatory, so editing must not become the back
    // door to having none: an omitted photoUrl keeps the current one, and an
    // empty string is rejected rather than treated as "clear it".
    if (body?.photoUrl !== undefined) {
      if (!photoUrl) {
        return NextResponse.json({ error: 'A profile photo is required.' }, { status: 400 });
      }
      // photo_url is rendered as an <img src> on staff screens, so only accept a
      // URL the client actually uploaded to our own public photo bucket. Same
      // check as /api/partner/complete-activation.
      if (!photoUrl.startsWith(`${process.env.NEXT_PUBLIC_SUPABASE_URL}${PHOTO_PATH_PREFIX}`)) {
        return NextResponse.json({ error: 'That photo could not be verified.' }, { status: 400 });
      }
      updates.photo_url = photoUrl;
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from('partner_profiles')
      .update(updates)
      .eq('user_id', user.id);

    if (error) {
      console.error('[partner profile] update failed', error);
      return NextResponse.json({ error: 'Could not save your profile.' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[partner profile] route error', err);
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}
