import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRequestUser } from '@/lib/auth-helpers';

export const runtime = 'nodejs';

const PHOTO_PATH_PREFIX = '/storage/v1/object/public/member-photos/';

// POST /api/portal/complete-activation
// Body: { fullName: string, photoUrl: string }
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
    const fullName = body?.fullName?.trim();
    const photoUrl = body?.photoUrl?.trim();

    if (!fullName) {
      return NextResponse.json({ error: 'Your name is required.' }, { status: 400 });
    }
    // Same rule approve-member applies to members: no photo, no active profile.
    if (!photoUrl) {
      return NextResponse.json({ error: 'A profile photo is required.' }, { status: 400 });
    }
    // photo_url is rendered as an <img src> on staff screens, so only accept a
    // URL the client actually uploaded to our own public photo bucket.
    if (!photoUrl.startsWith(`${process.env.NEXT_PUBLIC_SUPABASE_URL}${PHOTO_PATH_PREFIX}`)) {
      return NextResponse.json({ error: 'That photo could not be verified.' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: profile } = await admin
      .from('partner_profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: 'No partner invite found for this account.' }, { status: 404 });
    }

    const { error: updateErr } = await admin
      .from('partner_profiles')
      .update({
        full_name: fullName,
        photo_url: photoUrl,
        is_active: true,
        activated_at: new Date().toISOString(),
      })
      .eq('id', profile.id);

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
