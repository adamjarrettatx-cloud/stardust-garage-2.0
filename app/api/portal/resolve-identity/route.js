import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRequestUser } from '@/lib/auth-helpers';
import { findPartnerByInvitedEmail, relinkPartnerToUser } from '@/lib/partner-identity';

export const runtime = 'nodejs';

// POST /api/portal/resolve-identity
//
// "Which partner am I?", answered for a session that already exists. Called by
// /portal/activate once the magic-link tokens in the URL fragment have become
// a session.
//
// This is the mirror of what /portal/auth/callback does for Google, and both
// halves are needed. Once Google sign-in exists, a partner can hold two auth
// identities for one invited address — the one the invite pre-created and the
// one Google issued — and can arrive through either door. Whichever one is
// holding the session becomes the owner of the partner_profiles row, so the
// other never strands them.
//
// Without this route, a partner who signed in with Google (re-pointing the row
// at their Google identity) and later clicked an emailed link would authenticate
// as the original invite identity, match no partner_profiles row, and be told
// their link had expired.
//
// SECURITY: the match is on partner_profiles.invited_email against the email on
// the verified session — never on anything the client sends. No row is created
// here; an unrecognised account resolves to { profile: null }.
export async function POST(request) {
  try {
    const user = await getRequestUser(request);
    if (!user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const profile = await findPartnerByInvitedEmail(admin, user.email);

    if (!profile) {
      return NextResponse.json({ profile: null });
    }

    const { error: relinkError } = await relinkPartnerToUser({
      admin,
      profile,
      userId: user.id,
      userEmail: user.email,
      request,
    });

    if (relinkError) {
      // user_id is unique — this account is already the login for a different
      // contact's partner profile. Reported as no match rather than silently
      // handing back a profile the session cannot actually read under RLS.
      return NextResponse.json({ profile: null, conflict: true });
    }

    // Also fetch the linked contact's contact_type so the client can render the
    // role-specific eyebrow ("DJ SETUP", "COLLECTIVE SETUP", etc.). RLS on
    // contacts blocks a self-read for portal users, so we use the admin client
    // that we already have in this route — and read only the one column we need.
    let contactType = null;
    if (profile.contact_id) {
      const { data: contact } = await admin
        .from('contacts')
        .select('contact_type')
        .eq('id', profile.contact_id)
        .maybeSingle();
      contactType = contact?.contact_type || null;
    }

    return NextResponse.json({
      profile: {
        full_name: profile.full_name,
        photo_url: profile.photo_url,
        is_active: profile.is_active,
        contact_type: contactType,
      },
    });
  } catch (err) {
    console.error('resolve-identity route error:', err);
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || 'unknown') },
      { status: 500 }
    );
  }
}
