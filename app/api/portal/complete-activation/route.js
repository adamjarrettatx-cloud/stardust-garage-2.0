import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRequestUser } from '@/lib/auth-helpers';
import { isRestrictedStaffRole, partnerState } from '@/lib/partner-access';

export const runtime = 'nodejs';

// POST /api/portal/complete-activation
// Body: { fullName: string, photoPath: string }
//
// Finishes the invite: flips partner_profiles.is_active on and stores the name +
// photo the invitee just confirmed. Called by /portal/activate once the magic
// link has produced a session.
//
// SECURITY: the row updated is always the AUTHENTICATED caller's own
// (user_id = user.id) — no id is accepted from the client. is_active and
// activated_at are written with the service-role key because partners only hold
// a column-level UPDATE grant on (full_name, photo_url), so they cannot activate
// themselves and skip the photo (see 20260729_guest_list_partners.sql).
export async function POST(request) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : '';
    const photoPath = typeof body?.photoPath === 'string' ? body.photoPath.trim() : '';

    if (!fullName) {
      return NextResponse.json({ error: 'Your name is required.' }, { status: 400 });
    }
    if (fullName.length > 120) {
      return NextResponse.json({ error: 'Your name must be 120 characters or fewer.' }, { status: 400 });
    }
    // Same rule approve-member applies to members: no photo, no active profile.
    if (!photoPath) {
      return NextResponse.json({ error: 'A profile photo is required.' }, { status: 400 });
    }
    // Accept only a flat filename in the authenticated caller's namespace.
    // Storage RLS independently ensures only its uploader can read or write it.
    if (!isOwnedPartnerPhotoPath(photoPath, user.id)) {
      return NextResponse.json({ error: 'That photo could not be verified.' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: staff, error: staffError } = await admin
      .from('team_members').select('role').eq('user_id', user.id).maybeSingle();
    if (staffError || isRestrictedStaffRole(staff?.role)) {
      return NextResponse.json({ error: 'Partner activation is not available for this account.' }, { status: 403 });
    }
    const { data: profile } = await admin
      .from('partner_profiles')
      .select('id, is_active, activated_at')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: 'No partner invite found for this account.' }, { status: 404 });
    }
    if (partnerState(profile) === 'disabled') {
      return NextResponse.json({ error: 'Partner access has been disabled. Contact Stardust Garage.' }, { status: 403 });
    }
    if (partnerState(profile) === 'active') {
      return NextResponse.json({ ok: true });
    }

    const { error: updateErr } = await admin
      .from('partner_profiles')
      .update({
        full_name: fullName,
        photo_url: photoPath,
        is_active: true,
        activated_at: new Date().toISOString(),
      })
      .eq('id', profile.id)
      .is('activated_at', null);

    if (updateErr) {
      console.error('partner activation update failed:', updateErr);
      return NextResponse.json(
        { error: 'Could not save your profile: ' + updateErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('complete-activation route error:', err);
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || 'unknown') },
      { status: 500 }
    );
  }
}


function isOwnedPartnerPhotoPath(path, userId) {
  return typeof path === 'string'
    && path.startsWith(`${userId}/partner-`)
    && /^[0-9a-f-]{36}\/partner-[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(path);
}
