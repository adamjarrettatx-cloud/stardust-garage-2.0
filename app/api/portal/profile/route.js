import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requirePartner } from '@/lib/auth-helpers';

export const runtime = 'nodejs';

// PATCH /api/portal/profile
// Body: { fullName: string, photoPath?: string }
//
// The only way a partner edits their own record. Two columns, both used by staff on the night.
//
// SECURITY: this uses the caller's own session rather than the service-role
// client, and that is the point. Partners hold a column-level UPDATE grant on
// (full_name, photo_url) only — see 20260729_guest_list_partners.sql — so even
// if this route were tricked into passing is_active or contact_id through, the
// database would refuse the statement. /api/portal/complete-activation is
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
    const photoPath = typeof body?.photoPath === 'string' ? body.photoPath.trim() : '';

    if (!fullName) {
      return NextResponse.json({ error: 'Your name is required.' }, { status: 400 });
    }

    const updates = { full_name: fullName };

    // Activation made the photo mandatory, so editing must not become the back
    // door to having none: an omitted photoPath keeps the current one, and an
    // empty string is rejected rather than treated as "clear it".
    if (body?.photoPath !== undefined) {
      if (!photoPath) {
        return NextResponse.json({ error: 'A profile photo is required.' }, { status: 400 });
      }
      // Accept only a flat filename in the authenticated caller's namespace.
      // Storage RLS independently ensures only its uploader can read or write it.
      if (!isOwnedPartnerPhotoPath(photoPath, user.id)) {
        return NextResponse.json({ error: 'That photo could not be verified.' }, { status: 400 });
      }
      updates.photo_url = photoPath;
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


function isOwnedPartnerPhotoPath(path, userId) {
  return typeof path === 'string'
    && path.startsWith(`${userId}/partner-`)
    && /^[0-9a-f-]{36}\/partner-[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(path);
}
